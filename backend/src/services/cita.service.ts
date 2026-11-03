import crypto from 'node:crypto';
import { Prisma, type EstadoCita } from '@prisma/client';
import {
  ESTADOS_MODIFICABLES,
  HORAS_LIMITE_PACIENTE,
  MENSAJES,
  type CitaDTO,
  type ReprogramarDTO,
  type UsuarioSesion,
} from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { ahoraLima, dateAFecha, dateAHora, fechaADate, fechaPE, horaADate, instanteCita } from '../lib/fechas.js';
import { bloquesDelHorario, horasOcupadas } from './disponibilidad.service.js';

const HORA_MS = 3_600_000;
const horarioTomado = () => new ErrorNegocio(409, 'HORARIO_NO_DISPONIBLE', MENSAJES.HORARIO_NO_DISPONIBLE);
const citaNoEncontrada = () => new ErrorNegocio(404, 'CITA_NO_ENCONTRADA', MENSAJES.CITA_NO_ENCONTRADA);
const nuevoToken = () => crypto.randomBytes(24).toString('hex');

const INCLUIR = { odontologo: { include: { usuario: { select: { nombres: true } } } } } as const;
type CitaConOdontologo = Prisma.CitaGetPayload<{ include: typeof INCLUIR }>;

/** Horas que faltan para la cita (negativo si ya pasó). */
export const horasParaCita = (fecha: Date, hora: Date, ahora = new Date()) =>
  (instanteCita(dateAFecha(fecha), dateAHora(hora)).getTime() - ahora.getTime()) / HORA_MS;

/**
 * Valida un horario dentro de la transacción: odontólogo activo (con bloqueo de fila → RN-02),
 * dentro del horario de atención (RN-03) y libre (RN-02). `excluirCitaId`: la propia cita al reprogramar.
 */
async function validarHorario(tx: Tx, odontologoId: number, fecha: string, hora: string, excluirCitaId?: number) {
  const ahora = ahoraLima();
  if (fecha < ahora.fecha || (fecha === ahora.fecha && hora <= ahora.hora)) {
    throw new ErrorNegocio(422, 'HORA_PASADA', MENSAJES.HORA_PASADA);
  }
  // RN-02: bloqueo de la fila del odontólogo → las reservas simultáneas (web y presencial) se serializan.
  // El índice único parcial `cita_horario_activo` es la última barrera.
  const [odontologo] = await tx.$queryRaw<{ id: number; activo: boolean }[]>`
    SELECT id, activo FROM odontologos WHERE id = ${odontologoId} FOR UPDATE`;
  if (!odontologo?.activo) throw new ErrorNegocio(422, 'ODONTOLOGO_NO_DISPONIBLE', MENSAJES.ODONTOLOGO_NO_DISPONIBLE);

  const bloques = await bloquesDelHorario(tx, odontologoId, fecha);
  if (bloques.length === 0) throw new ErrorNegocio(422, 'CLINICA_NO_ATIENDE', MENSAJES.CLINICA_NO_ATIENDE);
  if (!bloques.includes(hora)) throw new ErrorNegocio(422, 'FUERA_DE_HORARIO', MENSAJES.FUERA_DE_HORARIO);

  const ocupadas = await horasOcupadas(tx, odontologoId, fecha, excluirCitaId);
  if (ocupadas.has(hora)) throw horarioTomado();
}

/**
 * Estado inicial de una cita (nueva o reprogramada).
 * RN-12: paciente restringido → pendiente de adelanto.
 * RN-04: debe confirmarse con ≥ 24 h. Si se reserva con menos de 24 h de anticipación ya no hay plazo
 * para confirmar: se registra directamente como confirmada (la tarea programada la liberaría de inmediato).
 * TODO(decisión): validar con la clínica el tratamiento de las reservas de último momento.
 */
function estadoInicial(restringido: boolean, fecha: string, hora: string): EstadoCita {
  if (restringido) return 'pendiente_adelanto';
  const horas = (instanteCita(fecha, hora).getTime() - Date.now()) / HORA_MS;
  return horas < 24 ? 'confirmada' : 'pendiente_confirmacion';
}

const conCarrera = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    // Carrera que pasó el bloqueo: el índice parcial rechaza el duplicado
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw horarioTomado();
    throw e;
  }
};

/**
 * CU-06 Registrar cita (c_grabarCita).
 * Web: el paciente sale de la sesión. Presencial: la recepcionista envía pacienteId (buscado por DNI).
 */
export async function registrarCita(dto: CitaDTO, usuario: UsuarioSesion) {
  const canal = usuario.rol === 'paciente' ? 'web' : 'presencial';
  const pacienteId = canal === 'web' ? usuario.pacienteId : dto.pacienteId;
  // RN-01: toda cita tiene paciente, odontólogo, fecha y hora (los demás los exige el esquema Zod)
  if (!pacienteId) {
    throw new ErrorNegocio(422, 'VALIDACION', 'Seleccione un paciente', { pacienteId: 'Seleccione un paciente' });
  }

  const cita = await conCarrera(() =>
    prisma.$transaction(async (tx) => {
      const paciente = await tx.paciente.findUnique({ where: { id: pacienteId } });
      if (!paciente) throw new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);
      await validarHorario(tx, dto.odontologoId, dto.fecha, dto.hora);
      return tx.cita.create({
        data: {
          pacienteId,
          odontologoId: dto.odontologoId,
          fecha: fechaADate(dto.fecha),
          hora: horaADate(dto.hora),
          motivo: dto.motivo,
          canal,
          estado: estadoInicial(paciente.restringido, dto.fecha, dto.hora), // 8.2 / RN-12
          tokenConfirmacion: nuevoToken(),
          creadoPorId: usuario.id,
        },
        include: INCLUIR,
      });
    }),
  );

  return {
    cita: formatearCita(cita),
    aviso: cita.estado === 'pendiente_adelanto' ? MENSAJES.ADELANTO_OBLIGATORIO : undefined,
  };
}

/**
 * Bloquea la cita y verifica que el usuario pueda modificarla (CU-07).
 * Paciente: solo sus citas y hasta 24 h antes (P8). Recepcionista: cualquier cita que aún no ocurra.
 */
async function citaModificable(tx: Tx, citaId: number, usuario: UsuarioSesion) {
  await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
  const cita = await tx.cita.findUnique({ where: { id: citaId }, include: { paciente: true } });
  // Al paciente no se le revela si existe la cita de otra persona
  if (!cita || (usuario.rol === 'paciente' && cita.pacienteId !== usuario.pacienteId)) throw citaNoEncontrada();
  const horas = horasParaCita(cita.fecha, cita.hora);
  if (!ESTADOS_MODIFICABLES.includes(cita.estado) || horas <= 0) {
    throw new ErrorNegocio(409, 'CITA_NO_MODIFICABLE', MENSAJES.CITA_NO_MODIFICABLE);
  }
  if (usuario.rol === 'paciente' && horas < HORAS_LIMITE_PACIENTE) {
    throw new ErrorNegocio(422, 'LIMITE_24H', MENSAJES.LIMITE_24H);
  }
  return cita;
}

/** CU-07 Reprogramar cita: nuevo horario (CU-05), nuevo enlace de confirmación. */
export async function reprogramarCita(citaId: number, dto: ReprogramarDTO, usuario: UsuarioSesion) {
  const cita = await conCarrera(() =>
    prisma.$transaction(async (tx) => {
      const actual = await citaModificable(tx, citaId, usuario);
      await validarHorario(tx, dto.odontologoId, dto.fecha, dto.hora, citaId);
      // Si aún debe el adelanto (RN-12) lo sigue debiendo; si no, vuelve a requerir confirmación
      const estado =
        actual.estado === 'pendiente_adelanto' ? 'pendiente_adelanto' : estadoInicial(false, dto.fecha, dto.hora);
      return tx.cita.update({
        where: { id: citaId },
        data: {
          odontologoId: dto.odontologoId,
          fecha: fechaADate(dto.fecha),
          hora: horaADate(dto.hora),
          estado,
          tokenConfirmacion: nuevoToken(), // el enlace anterior deja de servir
          recordatorioEnviadoEn: null,
        },
        include: INCLUIR,
      });
    }),
  );
  return formatearCita(cita);
}

/** CU-07 Cancelar cita: estado «Cancelada» y el horario queda libre (índice parcial). */
export async function cancelarCita(citaId: number, usuario: UsuarioSesion) {
  const cita = await prisma.$transaction(async (tx) => {
    await citaModificable(tx, citaId, usuario);
    return tx.cita.update({ where: { id: citaId }, data: { estado: 'cancelada' }, include: INCLUIR });
  });
  return formatearCita(cita);
}

/** Citas del paciente en sesión (vista web). */
export async function citasDelPaciente(pacienteId: number) {
  const citas = await prisma.cita.findMany({
    where: { pacienteId },
    orderBy: [{ fecha: 'desc' }, { hora: 'desc' }],
    include: INCLUIR,
  });
  return citas.map(formatearCita);
}

/**
 * CU-09 paso 1 (c_listarCitas): «Citas del día» de la recepcionista.
 * Solo datos de agenda y contacto (RN-07). Para las pendientes de confirmación incluye el enlace
 * wa.me con el mensaje de recordatorio, para enviarlo manualmente (P7).
 */
export async function citasDelDia(fecha: string) {
  const citas = await prisma.cita.findMany({
    where: { fecha: fechaADate(fecha) },
    orderBy: [{ hora: 'asc' }, { odontologoId: 'asc' }],
    include: {
      ...INCLUIR,
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, telefono: true, inasistencias: true, restringido: true } },
    },
  });
  const ahora = new Date();
  return citas.map((c) => ({
    ...formatearCita(c),
    paciente: c.paciente,
    puedeRegistrarInasistencia: c.estado === 'confirmada' && horasParaCita(c.fecha, c.hora, ahora) <= 0,
    whatsapp:
      c.estado === 'pendiente_confirmacion' && c.tokenConfirmacion
        ? enlaceWhatsapp(c.paciente.telefono, c.paciente.nombres, dateAFecha(c.fecha), dateAHora(c.hora), c.tokenConfirmacion)
        : undefined,
  }));
}

export const enlaceConfirmacion = (token: string) => `${process.env.FRONTEND_URL}/citas/confirmar/${token}`;

/** P7: enlace wa.me con el recordatorio, sin API de pago. */
export function enlaceWhatsapp(telefono: string, nombres: string, fecha: string, hora: string, token: string) {
  const texto =
    `Hola ${nombres}, le recordamos su cita en la Clínica Dental el ${fechaPE(fecha)} a las ${hora}. ` +
    `Confírmela aquí: ${enlaceConfirmacion(token)}`;
  return `https://wa.me/51${telefono}?text=${encodeURIComponent(texto)}`;
}

/**
 * CU-09 Registrar inasistencia (c_registrarInasistencia).
 * En una transacción: cita → «Inasistencia», contador +1, nota en la ficha y, a la 3.ª, paciente restringido (RN-12).
 */
export async function registrarInasistencia(citaId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const cita = await tx.cita.findUnique({ where: { id: citaId } });
    if (!cita) throw citaNoEncontrada();
    if (cita.estado !== 'confirmada') {
      throw new ErrorNegocio(409, 'INASISTENCIA_SOLO_CONFIRMADA', MENSAJES.INASISTENCIA_SOLO_CONFIRMADA);
    }
    // 3.1: si la hora de la cita aún no pasó, no se permite
    if (horasParaCita(cita.fecha, cita.hora) > 0) throw new ErrorNegocio(422, 'HORA_NO_PASADA', MENSAJES.HORA_NO_PASADA);

    await tx.cita.update({ where: { id: citaId }, data: { estado: 'inasistencia' } });
    const paciente = await tx.paciente.update({
      where: { id: cita.pacienteId },
      data: { inasistencias: { increment: 1 } },
    });
    const restringido = paciente.inasistencias >= 3; // 6.1
    if (restringido && !paciente.restringido) {
      await tx.paciente.update({ where: { id: paciente.id }, data: { restringido: true } });
    }
    // Anotar en la ficha (CU-09 paso 3)
    const ficha = await tx.fichaPaciente.findUniqueOrThrow({ where: { pacienteId: paciente.id } });
    const nota = `${fechaPE(dateAFecha(cita.fecha))} ${dateAHora(cita.hora)}: inasistencia (${paciente.inasistencias}.ª)`;
    await tx.fichaPaciente.update({
      where: { id: ficha.id },
      data: { notas: ficha.notas ? `${ficha.notas}\n${nota}` : nota },
    });

    return {
      estado: 'inasistencia' as const,
      inasistencias: paciente.inasistencias,
      restringido,
      aviso: restringido ? MENSAJES.PACIENTE_RESTRINGIDO : undefined,
    };
  });
}

// No se expone token_confirmacion: solo viaja en el recordatorio (RNF08)
function formatearCita(c: CitaConOdontologo) {
  return {
    id: c.id,
    pacienteId: c.pacienteId,
    odontologoId: c.odontologoId,
    odontologo: c.odontologo.usuario.nombres,
    fecha: dateAFecha(c.fecha),
    hora: dateAHora(c.hora),
    motivo: c.motivo,
    canal: c.canal,
    estado: c.estado,
  };
}
