import crypto from 'node:crypto';
import { Prisma, type EstadoCita } from '@prisma/client';
import {
  ESTADOS_MODIFICABLES,
  HORAS_LIMITE_PACIENTE,
  MENSAJES,
  MINUTOS_PAGO_ADELANTO,
  type CitaDTO,
  type ReportarPagoDTO,
  type ReprogramarDTO,
  type UsuarioSesion,
} from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { ahoraLima, dateAFecha, dateAHora, fechaADate, fechaPE, horaADate, instanteCita } from '../lib/fechas.js';
import { bloquesDelHorario, feriadoEn, horasOcupadas } from './disponibilidad.service.js';
import { calcularAdelanto, edadEn } from './precio.service.js';
import { moverSaldo } from './saldo.service.js';
import { billeterasAceptadas, datosPago } from './pago.service.js';

const HORA_MS = 3_600_000;
const horarioTomado = () => new ErrorNegocio(409, 'HORARIO_NO_DISPONIBLE', MENSAJES.HORARIO_NO_DISPONIBLE);
const citaNoEncontrada = () => new ErrorNegocio(404, 'CITA_NO_ENCONTRADA', MENSAJES.CITA_NO_ENCONTRADA);
const nuevoToken = () => crypto.randomBytes(24).toString('hex');

const INCLUIR = {
  odontologo: { include: { usuario: { select: { nombres: true } } } },
  tratamientoPrevisto: { select: { id: true, nombre: true } },
  comprobantes: { where: { anuladoEn: null }, select: { tipo: true, total: true } }, // solo vigentes
} as const;
// pagoCaptura se omite de forma global (lib/prisma.ts)
type CitaCompleta = Omit<Prisma.CitaGetPayload<{ include: typeof INCLUIR }>, 'pagoCaptura'>;

/** Horas que faltan para la cita (negativo si ya pasó). */
export const horasParaCita = (fecha: Date, hora: Date, ahora = new Date()) =>
  (instanteCita(dateAFecha(fecha), dateAHora(hora)).getTime() - ahora.getTime()) / HORA_MS;

/**
 * Valida un horario dentro de la transacción: odontólogo activo (con bloqueo de fila → RN-02),
 * no feriado, dentro del horario de atención (RN-03) y libre (RN-02). `excluirCitaId`: la propia cita al reprogramar.
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

  const feriado = await feriadoEn(tx, fecha);
  if (feriado) throw new ErrorNegocio(422, 'CLINICA_FERIADO', `${MENSAJES.CLINICA_FERIADO}: ${feriado}`);
  const bloques = await bloquesDelHorario(tx, odontologoId, fecha);
  if (bloques.length === 0) throw new ErrorNegocio(422, 'CLINICA_NO_ATIENDE', MENSAJES.CLINICA_NO_ATIENDE);
  if (!bloques.includes(hora)) throw new ErrorNegocio(422, 'FUERA_DE_HORARIO', MENSAJES.FUERA_DE_HORARIO);

  const ocupadas = await horasOcupadas(tx, odontologoId, fecha, excluirCitaId);
  if (ocupadas.has(hora)) throw horarioTomado();
}

/** Regla acordada: pagan adelanto los pacientes con 3+ inasistencias (RN-12) y las reservas con < 24 h. */
export function requiereAdelanto(restringido: boolean, fecha: string, hora: string, ahora = new Date()) {
  return restringido || (instanteCita(fecha, hora).getTime() - ahora.getTime()) / HORA_MS < 24;
}

/** Tratamiento previsto: el elegido (activo) o, si no se eligió, la Consulta. */
async function resolverTratamientoPrevisto(tx: Tx, id: number | null | undefined) {
  if (id) {
    const t = await tx.tratamiento.findUnique({ where: { id } });
    if (!t?.activo) throw new ErrorNegocio(422, 'TRATAMIENTO_NO_TARIFARIO', MENSAJES.TRATAMIENTO_NO_TARIFARIO, { tratamientoPrevistoId: MENSAJES.TRATAMIENTO_NO_TARIFARIO });
    return t.id;
  }
  const consulta = await tx.tratamiento.findFirst({ where: { nombre: { equals: 'Consulta', mode: 'insensitive' }, activo: true } });
  return consulta?.id ?? null;
}

/** Estado y datos de adelanto de una cita nueva (o reprogramada sin adelanto pagado). */
async function estadoYAdelanto(tx: Tx, p: { restringido: boolean; fechaNacimiento: Date }, tratamientoId: number | null, fecha: string, hora: string) {
  if (!requiereAdelanto(p.restringido, fecha, hora)) {
    return { estado: 'pendiente_confirmacion' as EstadoCita, montoAdelanto: null, adelantoVenceEn: null };
  }
  if (!tratamientoId) {
    throw new ErrorNegocio(422, 'TRATAMIENTO_PREVISTO_REQUERIDO', MENSAJES.TRATAMIENTO_PREVISTO_REQUERIDO, { tratamientoPrevistoId: MENSAJES.TRATAMIENTO_PREVISTO_REQUERIDO });
  }
  return {
    estado: 'pendiente_adelanto' as EstadoCita,
    montoAdelanto: await calcularAdelanto(tx, tratamientoId, fecha, edadEn(p.fechaNacimiento, fecha)),
    adelantoVenceEn: new Date(Date.now() + MINUTOS_PAGO_ADELANTO * 60_000),
  };
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
      const tratamientoPrevistoId = await resolverTratamientoPrevisto(tx, dto.tratamientoPrevistoId);
      const adelanto = await estadoYAdelanto(tx, paciente, tratamientoPrevistoId, dto.fecha, dto.hora); // 8.2 / RN-12 / < 24 h
      return tx.cita.create({
        data: {
          pacienteId,
          odontologoId: dto.odontologoId,
          fecha: fechaADate(dto.fecha),
          hora: horaADate(dto.hora),
          motivo: dto.motivo,
          canal,
          tratamientoPrevistoId,
          ...adelanto,
          tokenConfirmacion: nuevoToken(),
          creadoPorId: usuario.id,
        },
        include: INCLUIR,
      });
    }),
  );

  const pendiente = cita.estado === 'pendiente_adelanto';
  return {
    cita: formatearCita(cita),
    aviso: pendiente ? MENSAJES.ADELANTO_OBLIGATORIO : undefined,
    pago: pendiente ? await datosPago() : undefined,
  };
}

/**
 * Bloquea la cita y verifica que el usuario pueda modificarla (CU-07).
 * Paciente: solo sus citas y hasta 24 h antes (P8). Recepcionista: cualquier cita que aún no ocurra.
 */
async function citaModificable(tx: Tx, citaId: number, usuario: UsuarioSesion) {
  await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
  const cita = await tx.cita.findUnique({ where: { id: citaId }, include: { paciente: true, comprobantes: { where: { anuladoEn: null } } } });
  // Al paciente no se le revela si existe la cita de otra persona
  if (!cita || (usuario.rol === 'paciente' && cita.pacienteId !== usuario.pacienteId)) throw citaNoEncontrada();
  if (cita.estado === 'pago_en_verificacion') throw new ErrorNegocio(409, 'PAGO_EN_VERIFICACION', MENSAJES.PAGO_EN_VERIFICACION);
  const horas = horasParaCita(cita.fecha, cita.hora);
  if (!ESTADOS_MODIFICABLES.includes(cita.estado) || horas <= 0) {
    throw new ErrorNegocio(409, 'CITA_NO_MODIFICABLE', MENSAJES.CITA_NO_MODIFICABLE);
  }
  if (usuario.rol === 'paciente' && horas < HORAS_LIMITE_PACIENTE) {
    throw new ErrorNegocio(422, 'LIMITE_24H', MENSAJES.LIMITE_24H);
  }
  return cita;
}

const adelantoPagadoDe = (comprobantes: { tipo: string; total: Prisma.Decimal }[]) => comprobantes.find((c) => c.tipo === 'adelanto')?.total ?? null;

/**
 * CU-07 Reprogramar cita: nuevo horario (CU-05), nuevo enlace de confirmación.
 * Si ya pagó el adelanto, el adelanto pasa a la nueva fecha y la cita sigue «Confirmada».
 */
export async function reprogramarCita(citaId: number, dto: ReprogramarDTO, usuario: UsuarioSesion) {
  const cita = await conCarrera(() =>
    prisma.$transaction(async (tx) => {
      const actual = await citaModificable(tx, citaId, usuario);
      await validarHorario(tx, dto.odontologoId, dto.fecha, dto.hora, citaId);
      const datos = adelantoPagadoDe(actual.comprobantes)
        ? { estado: 'confirmada' as EstadoCita, adelantoVenceEn: null }
        : await estadoYAdelanto(tx, actual.paciente, actual.tratamientoPrevistoId ?? (await resolverTratamientoPrevisto(tx, null)), dto.fecha, dto.hora);
      return tx.cita.update({
        where: { id: citaId },
        data: {
          odontologoId: dto.odontologoId,
          fecha: fechaADate(dto.fecha),
          hora: horaADate(dto.hora),
          ...datos,
          tokenConfirmacion: nuevoToken(), // el enlace anterior deja de servir
          recordatorioEnviadoEn: null,
        },
        include: INCLUIR,
      });
    }),
  );
  return formatearCita(cita);
}

export type ResultadoAdelanto = { monto: string; resultado: 'saldo_a_favor' | 'devuelto' | 'perdido' } | null;

/**
 * Qué pasa con el adelanto pagado al cancelar (regla acordada):
 * cancela la clínica → se devuelve; cancela el paciente con ≥ 24 h → saldo a favor; con < 24 h → se pierde.
 */
export async function resolverAdelantoAlCancelar(
  tx: Tx,
  cita: { id: number; pacienteId: number; fecha: Date; hora: Date; comprobantes: { tipo: string; total: Prisma.Decimal }[] },
  usuarioId: number,
  porClinica: boolean,
): Promise<ResultadoAdelanto> {
  const pagado = adelantoPagadoDe(cita.comprobantes);
  if (!pagado || pagado.isZero()) return null;
  if (porClinica) {
    await tx.devolucion.create({ data: { citaId: cita.id, pacienteId: cita.pacienteId, monto: pagado, motivo: 'Cita cancelada por la clínica', usuarioId } });
    return { monto: pagado.toFixed(2), resultado: 'devuelto' };
  }
  if (horasParaCita(cita.fecha, cita.hora) >= 24) {
    await moverSaldo(tx, { pacienteId: cita.pacienteId, tipo: 'abono_cancelacion', monto: pagado, usuarioId, citaId: cita.id, motivo: 'Adelanto de cita cancelada con 24 h o más' });
    return { monto: pagado.toFixed(2), resultado: 'saldo_a_favor' };
  }
  return { monto: pagado.toFixed(2), resultado: 'perdido' };
}

/** CU-07 Cancelar cita: estado «Cancelada», el horario queda libre y se resuelve el adelanto si lo hubo. */
export async function cancelarCita(citaId: number, usuario: UsuarioSesion, opciones: { porClinica?: boolean } = {}) {
  const porClinica = usuario.rol === 'recepcionista' && !!opciones.porClinica;
  return prisma.$transaction(async (tx) => {
    const actual = await citaModificable(tx, citaId, usuario);
    const adelanto = await resolverAdelantoAlCancelar(tx, actual, usuario.id, porClinica);
    const cita = await tx.cita.update({ where: { id: citaId }, data: { estado: 'cancelada', adelantoVenceEn: null }, include: INCLUIR });
    return { ...formatearCita(cita), adelanto };
  });
}

/**
 * El paciente reporta que pagó el adelanto por Yape/Plin (opción 1). La cita pasa a «Pago en verificación»
 * y ya no se libera sola; la recepcionista aprueba o rechaza en Caja.
 */
export async function reportarPago(citaId: number, usuario: UsuarioSesion, dto: ReportarPagoDTO) {
  const captura = dto.captura ? dto.captura.slice(dto.captura.indexOf(',') + 1) : null;
  const cita = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const c = await tx.cita.findUnique({ where: { id: citaId } });
    if (!c || c.pacienteId !== usuario.pacienteId) throw citaNoEncontrada();
    if (c.estado !== 'pendiente_adelanto') throw new ErrorNegocio(409, 'PAGO_NO_REPORTABLE', MENSAJES.PAGO_NO_REPORTABLE);
    if (!(await billeterasAceptadas(tx)).includes(dto.metodo)) throw new ErrorNegocio(422, 'BILLETERA_NO_ACEPTADA', MENSAJES.BILLETERA_NO_ACEPTADA, { metodo: MENSAJES.BILLETERA_NO_ACEPTADA });
    if (c.adelantoVenceEn && c.adelantoVenceEn < new Date()) throw new ErrorNegocio(422, 'ADELANTO_VENCIDO', MENSAJES.ADELANTO_VENCIDO);
    return tx.cita.update({
      where: { id: citaId },
      data: {
        estado: 'pago_en_verificacion',
        pagoMetodo: dto.metodo,
        pagoOperacion: dto.numeroOperacion,
        pagoCaptura: captura ? Buffer.from(captura, 'base64') : null,
        pagoCapturaTipo: dto.captura ? dto.captura.slice(5, dto.captura.indexOf(';')) : null,
        pagoReportadoEn: new Date(),
        pagoRechazoMotivo: null,
      },
      include: INCLUIR,
    });
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
 * Si había pagado adelanto, lo pierde (regla acordada).
 */
export async function registrarInasistencia(citaId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const cita = await tx.cita.findUnique({ where: { id: citaId }, include: { comprobantes: { where: { anuladoEn: null } } } });
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
    const perdido = adelantoPagadoDe(cita.comprobantes);
    // Anotar en la ficha (CU-09 paso 3)
    const ficha = await tx.fichaPaciente.findUniqueOrThrow({ where: { pacienteId: paciente.id } });
    const nota =
      `${fechaPE(dateAFecha(cita.fecha))} ${dateAHora(cita.hora)}: inasistencia (${paciente.inasistencias}.ª)` +
      (perdido ? `; pierde el adelanto de S/ ${perdido.toFixed(2)}` : '');
    await tx.fichaPaciente.update({
      where: { id: ficha.id },
      data: { notas: ficha.notas ? `${ficha.notas}\n${nota}` : nota },
    });

    return {
      estado: 'inasistencia' as const,
      inasistencias: paciente.inasistencias,
      restringido,
      adelantoPerdido: perdido?.toFixed(2) ?? null,
      aviso: restringido ? MENSAJES.PACIENTE_RESTRINGIDO : undefined,
    };
  });
}

// No se expone token_confirmacion ni la captura del pago (RNF08)
export function formatearCita(c: CitaCompleta) {
  const pagado = adelantoPagadoDe(c.comprobantes);
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
    tratamientoPrevisto: c.tratamientoPrevisto?.nombre ?? null,
    montoAdelanto: c.montoAdelanto?.toFixed(2) ?? null,
    adelantoVenceEn: c.adelantoVenceEn?.toISOString() ?? null,
    adelantoPagado: pagado?.toFixed(2) ?? null,
    pagoReportado: c.pagoOperacion && c.pagoReportadoEn ? { metodo: c.pagoMetodo, numeroOperacion: c.pagoOperacion, reportadoEn: c.pagoReportadoEn.toISOString() } : null,
    pagoRechazoMotivo: c.pagoRechazoMotivo,
  };
}
