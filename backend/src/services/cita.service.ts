import crypto from 'node:crypto';
import { Prisma, type EstadoCita } from '@prisma/client';
import {
  ESTADOS_MODIFICABLES,
  fechaMaximaCita,
  HORAS_LIMITE_PACIENTE,
  MENSAJES,
  motivoAMostrar,
  PORCENTAJE_ADELANTO,
  PORCENTAJE_ADELANTO_RESTRINGIDO,
  MINUTOS_PAGO_ADELANTO,
  type CitaDTO,
  type ReportarPagoDTO,
  type ReprogramarDTO,
  type UsuarioSesion,
} from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { ahoraLima, dateAFecha, dateAHora, fechaADate, fechaPE, horaADate, instanteCita } from '../lib/fechas.js';
import { bloquesDelHorario, feriadoEn, horasOcupadas, mensajeSinAtencion } from './disponibilidad.service.js';
import { calcularAdelanto, edadEn } from './precio.service.js';
import { moverSaldo } from './saldo.service.js';
import { billeterasAceptadas, datosPago } from './pago.service.js';
import { registrar as auditar } from './auditoria.service.js';

const HORA_MS = 3_600_000;
const horarioTomado = () => new ErrorNegocio(409, 'HORARIO_NO_DISPONIBLE', MENSAJES.HORARIO_NO_DISPONIBLE);
const citaNoEncontrada = () => new ErrorNegocio(404, 'CITA_NO_ENCONTRADA', MENSAJES.CITA_NO_ENCONTRADA);
const nuevoToken = () => crypto.randomBytes(24).toString('hex');

const INCLUIR = {
  odontologo: { include: { usuario: { select: { nombres: true } } } },
  tratamientoPrevisto: { select: { id: true, nombre: true } },
  comprobantes: { where: { anuladoEn: null }, select: { tipo: true, subtotal: true, total: true, saldoAplicado: true } }, // solo vigentes
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
  if (fecha > fechaMaximaCita(ahora.fecha)) throw new ErrorNegocio(422, 'FECHA_MUY_LEJANA', MENSAJES.FECHA_MUY_LEJANA);
  // RN-02: bloqueo de la fila del odontólogo → las reservas simultáneas (web y presencial) se serializan.
  // El índice único parcial `cita_horario_activo` es la última barrera.
  const [odontologo] = await tx.$queryRaw<{ id: number; activo: boolean }[]>`
    SELECT id, activo FROM odontologos WHERE id = ${odontologoId} FOR UPDATE`;
  if (!odontologo?.activo) throw new ErrorNegocio(422, 'ODONTOLOGO_NO_DISPONIBLE', MENSAJES.ODONTOLOGO_NO_DISPONIBLE);

  const feriado = await feriadoEn(tx, fecha);
  if (feriado) throw new ErrorNegocio(422, 'CLINICA_FERIADO', `${MENSAJES.CLINICA_FERIADO}: ${feriado}`);
  const bloques = await bloquesDelHorario(tx, odontologoId, fecha);
  if (bloques.length === 0) throw new ErrorNegocio(422, 'CLINICA_NO_ATIENDE', await mensajeSinAtencion(tx, odontologoId, fecha));
  if (!bloques.includes(hora)) throw new ErrorNegocio(422, 'FUERA_DE_HORARIO', MENSAJES.FUERA_DE_HORARIO);

  const ocupadas = await horasOcupadas(tx, odontologoId, fecha, excluirCitaId);
  if (ocupadas.has(hora)) throw horarioTomado();
}

/** RN-12 (v2): toda reserva paga adelanto; 50 % del tratamiento previsto, o 100 % con 3 o más inasistencias. */
export const porcentajeAdelanto = (restringido: boolean) => (restringido ? PORCENTAJE_ADELANTO_RESTRINGIDO : PORCENTAJE_ADELANTO);

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

/** Estado y datos de adelanto de una cita nueva (o reprogramada sin adelanto pagado): siempre «Pendiente de adelanto». */
async function estadoYAdelanto(tx: Tx, p: { restringido: boolean; fechaNacimiento: Date }, tratamientoId: number | null, fecha: string) {
  if (!tratamientoId) {
    throw new ErrorNegocio(422, 'TRATAMIENTO_PREVISTO_REQUERIDO', MENSAJES.TRATAMIENTO_PREVISTO_REQUERIDO, { tratamientoPrevistoId: MENSAJES.TRATAMIENTO_PREVISTO_REQUERIDO });
  }
  return {
    estado: 'pendiente_adelanto' as EstadoCita,
    montoAdelanto: await calcularAdelanto(tx, tratamientoId, fecha, edadEn(p.fechaNacimiento, fecha), porcentajeAdelanto(p.restringido)),
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
      const adelanto = await estadoYAdelanto(tx, paciente, tratamientoPrevistoId, dto.fecha); // toda reserva; RN-12: 100 %
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

  // Si el saldo a favor cubre todo el adelanto, se paga con él y la cita queda confirmada al instante
  const saldo = (await prisma.paciente.findUniqueOrThrow({ where: { id: cita.pacienteId }, select: { saldoFavor: true } })).saldoFavor;
  if (cita.montoAdelanto && cita.montoAdelanto.greaterThan(0) && saldo.greaterThanOrEqualTo(cita.montoAdelanto)) {
    const { pagarAdelantoConSaldo } = await import('./caja.service.js');
    await pagarAdelantoConSaldo(cita.id, usuario);
    const confirmada = await prisma.cita.findUniqueOrThrow({ where: { id: cita.id }, include: INCLUIR });
    return { cita: formatearCita(confirmada, saldo.minus(cita.montoAdelanto)), aviso: MENSAJES.ADELANTO_CUBIERTO_SALDO, pago: undefined };
  }
  return {
    cita: formatearCita(cita, saldo),
    aviso: MENSAJES.ADELANTO_OBLIGATORIO,
    pago: await datosPago(),
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

type ComprobanteBreve = { tipo: string; subtotal: Prisma.Decimal; total: Prisma.Decimal; saldoAplicado: Prisma.Decimal };
/** Valor del adelanto pagado (lo cobrado + el saldo a favor usado en él). */
const adelantoPagadoDe = (comprobantes: ComprobanteBreve[]) => comprobantes.find((c) => c.tipo === 'adelanto')?.subtotal ?? null;

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
        : await estadoYAdelanto(tx, actual.paciente, actual.tratamientoPrevistoId ?? (await resolverTratamientoPrevisto(tx, null)), dto.fecha);
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
  cita: { id: number; pacienteId: number; fecha: Date; hora: Date; comprobantes: ComprobanteBreve[] },
  usuarioId: number,
  porClinica: boolean,
): Promise<ResultadoAdelanto> {
  const pagado = adelantoPagadoDe(cita.comprobantes);
  if (!pagado || pagado.isZero()) return null;
  if (porClinica) {
    // Se devuelve lo cobrado; la parte pagada con saldo a favor vuelve al saldo
    const comp = cita.comprobantes.find((c) => c.tipo === 'adelanto')!;
    if (comp.total.greaterThan(0)) {
      await tx.devolucion.create({ data: { citaId: cita.id, pacienteId: cita.pacienteId, monto: comp.total, motivo: 'Cita cancelada por la clínica', usuarioId } });
    }
    await moverSaldo(tx, { pacienteId: cita.pacienteId, tipo: 'abono_cancelacion', monto: comp.saldoAplicado, usuarioId, citaId: cita.id, motivo: 'Saldo usado en el adelanto de una cita cancelada por la clínica' });
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
  const { saldoFavor } = await prisma.paciente.findUniqueOrThrow({ where: { id: pacienteId }, select: { saldoFavor: true } });
  return citas.map((c) => formatearCita(c, saldoFavor));
}

/**
 * CU-09 paso 1 (c_listarCitas): «Agenda» (citas de una fecha) de la recepcionista.
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
  return citas.map((c) => itemAgenda(c, ahora));
}

type CitaConPaciente = CitaCompleta & { tokenConfirmacion: string | null; paciente: { id: number; dni: string | null; nombres: string; apellidos: string; telefono: string; inasistencias: number; restringido: boolean } };
/** Una cita como la ve la recepcionista (Agenda y Buscar cita): agenda y contacto, nada clínico (RN-07). */
function itemAgenda(c: CitaConPaciente, ahora: Date) {
  return {
    ...formatearCita(c),
    paciente: c.paciente,
    puedeRegistrarInasistencia: c.estado === 'confirmada' && horasParaCita(c.fecha, c.hora, ahora) <= 0,
    // P7: recordatorio por WhatsApp de las citas confirmadas que aún no ocurren (y de las antiguas sin confirmar)
    whatsapp:
      (c.estado === 'confirmada' || c.estado === 'pendiente_confirmacion') && c.tokenConfirmacion && horasParaCita(c.fecha, c.hora, ahora) > 0
        ? enlaceWhatsapp(c.paciente.telefono, c.paciente.nombres, dateAFecha(c.fecha), dateAHora(c.hora), c.tokenConfirmacion, c.estado === 'pendiente_confirmacion')
        : undefined,
  };
}

/** Estados de una cita que todavía «está por venir» (o se atiende hoy y falta cobrar). */
const ESTADOS_PROXIMOS = ['pendiente_confirmacion', 'pendiente_adelanto', 'pago_en_verificacion', 'confirmada', 'atendida'] as const;

/**
 * Buscar cita (recepcionista): las citas de un paciente. Próximas (con sus acciones) y anteriores (solo consulta).
 * Solo agenda y contacto; los diagnósticos y tratamientos realizados son del odontólogo (RN-07).
 */
export async function buscarCitasDe(pacienteId: number) {
  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    select: { id: true, dni: true, nombres: true, apellidos: true, telefono: true, inasistencias: true, restringido: true, fechaNacimiento: true, saldoFavor: true },
  });
  if (!paciente) throw new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);
  const citas = await prisma.cita.findMany({
    where: { pacienteId },
    orderBy: [{ fecha: 'asc' }, { hora: 'asc' }],
    include: { ...INCLUIR, paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, telefono: true, inasistencias: true, restringido: true } } },
  });
  const ahora = new Date();
  const hoy = ahoraLima().fecha;
  const esProxima = (c: (typeof citas)[number]) => (ESTADOS_PROXIMOS as readonly string[]).includes(c.estado) && dateAFecha(c.fecha) >= hoy;
  return {
    paciente: { ...paciente, fechaNacimiento: dateAFecha(paciente.fechaNacimiento), saldoFavor: paciente.saldoFavor.toFixed(2) },
    proximas: citas.filter(esProxima).map((c) => itemAgenda(c, ahora)),
    anteriores: citas
      .filter((c) => !esProxima(c))
      .reverse()
      .slice(0, 50)
      .map((c) => ({ id: c.id, fecha: dateAFecha(c.fecha), hora: dateAHora(c.hora), odontologo: c.odontologo.usuario.nombres, motivo: motivoAMostrar(c.motivo, c.tratamientoPrevisto?.nombre), estado: c.estado })),
  };
}

/** Resumen para la lista de búsqueda: cuántas citas próximas tiene cada paciente y cuándo es la siguiente. */
export async function resumenProximas(pacienteIds: number[]) {
  if (pacienteIds.length === 0) return new Map<number, { proximas: number; siguiente: string | null }>();
  const hoy = fechaADate(ahoraLima().fecha);
  const citas = await prisma.cita.findMany({
    where: { pacienteId: { in: pacienteIds }, fecha: { gte: hoy }, estado: { in: [...ESTADOS_PROXIMOS] } },
    orderBy: [{ fecha: 'asc' }, { hora: 'asc' }],
    select: { pacienteId: true, fecha: true, hora: true },
  });
  const r = new Map<number, { proximas: number; siguiente: string | null }>();
  for (const c of citas) {
    const x = r.get(c.pacienteId) ?? { proximas: 0, siguiente: `${dateAFecha(c.fecha)} ${dateAHora(c.hora)}` };
    x.proximas++;
    r.set(c.pacienteId, x);
  }
  return r;
}

/** CU-08 Recordar cita: enlace público (la ruta antigua /citas/confirmar/ sigue funcionando). */
export const enlaceConfirmacion = (token: string) => `${process.env.FRONTEND_URL}/citas/recordatorio/${token}`;

/** P7: enlace wa.me con el recordatorio, sin API de pago. */
export function enlaceWhatsapp(telefono: string, nombres: string, fecha: string, hora: string, token: string, pedirConfirmacion = false) {
  const texto =
    `Hola ${nombres}, le recordamos su cita en la Clínica Dental el ${fechaPE(fecha)} a las ${hora}. ` +
    (pedirConfirmacion
      ? `Confírmela aquí: ${enlaceConfirmacion(token)}`
      : `Si no puede asistir, puede cancelar o reprogramar aquí (hasta 24 h antes): ${enlaceConfirmacion(token)}`);
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
/** `saldoFavor` (opcional): saldo del paciente, para indicar cuánto del adelanto pendiente cubre. */
export function formatearCita(c: CitaCompleta, saldoFavor?: Prisma.Decimal) {
  const pagado = adelantoPagadoDe(c.comprobantes);
  const pendiente = c.estado === 'pendiente_adelanto' && c.montoAdelanto ? c.montoAdelanto : null;
  const cubre = pendiente && saldoFavor ? Prisma.Decimal.min(saldoFavor, pendiente) : null;
  return {
    id: c.id,
    pacienteId: c.pacienteId,
    odontologoId: c.odontologoId,
    odontologo: c.odontologo.usuario.nombres,
    fecha: dateAFecha(c.fecha),
    hora: dateAHora(c.hora),
    // Motivo opcional (pendiente 21): si no se escribió, se muestra el tratamiento previsto
    motivo: motivoAMostrar(c.motivo, c.tratamientoPrevisto?.nombre),
    motivoEscrito: c.motivo,
    canal: c.canal,
    estado: c.estado,
    tratamientoPrevisto: c.tratamientoPrevisto?.nombre ?? null,
    tratamientoPrevistoId: c.tratamientoPrevisto?.id ?? null,
    montoAdelanto: c.montoAdelanto?.toFixed(2) ?? null,
    adelantoVenceEn: c.adelantoVenceEn?.toISOString() ?? null,
    adelantoPagado: pagado?.toFixed(2) ?? null,
    pagoReportado: c.pagoOperacion && c.pagoReportadoEn ? { metodo: c.pagoMetodo, numeroOperacion: c.pagoOperacion, reportadoEn: c.pagoReportadoEn.toISOString() } : null,
    pagoRechazoMotivo: c.pagoRechazoMotivo,
    // Adelanto pendiente: parte cubierta con saldo a favor y lo que falta pagar
    saldoAplicable: cubre && cubre.greaterThan(0) ? cubre.toFixed(2) : null,
    aPagar: pendiente ? pendiente.minus(cubre ?? 0).toFixed(2) : null,
  };
}

/**
 * Editar datos de la cita (recepcionista): el motivo, mientras la cita no ocurra; el tratamiento previsto, solo
 * si el adelanto aún no se pagó ni está en verificación (el monto del adelanto se recalcula con el nuevo tratamiento).
 * Fecha, hora y odontólogo se cambian con «Reprogramar» (CU-07). Queda en la auditoría (RN-22).
 */
export async function editarDatosCita(citaId: number, dto: { motivo: string; tratamientoPrevistoId?: number }, usuarioId: number, ip?: string) {
  const cita = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const c = await tx.cita.findUnique({ where: { id: citaId }, include: { paciente: true, tratamientoPrevisto: true, comprobantes: { where: { anuladoEn: null } } } });
    if (!c) throw new ErrorNegocio(404, 'CITA_NO_ENCONTRADA', MENSAJES.CITA_NO_ENCONTRADA);
    if (!ESTADOS_MODIFICABLES.includes(c.estado) && c.estado !== 'pago_en_verificacion') {
      throw new ErrorNegocio(409, 'CITA_NO_EDITABLE', MENSAJES.CITA_NO_EDITABLE);
    }
    const cambios: string[] = [];
    const data: Prisma.CitaUpdateInput = {};
    if (dto.motivo !== c.motivo) {
      data.motivo = dto.motivo;
      cambios.push(`Motivo: «${c.motivo || '—'}» → «${dto.motivo || '—'}»`);
    }
    if (dto.tratamientoPrevistoId && dto.tratamientoPrevistoId !== c.tratamientoPrevistoId) {
      const pagado = c.comprobantes.some((x) => x.tipo === 'adelanto');
      if (c.estado !== 'pendiente_adelanto' || pagado) {
        throw new ErrorNegocio(409, 'TRATAMIENTO_CON_ADELANTO', MENSAJES.TRATAMIENTO_CON_ADELANTO, { tratamientoPrevistoId: MENSAJES.TRATAMIENTO_CON_ADELANTO });
      }
      const nuevoId = await resolverTratamientoPrevisto(tx, dto.tratamientoPrevistoId);
      const { montoAdelanto } = await estadoYAdelanto(tx, c.paciente, nuevoId, dateAFecha(c.fecha));
      const nuevo = await tx.tratamiento.findUniqueOrThrow({ where: { id: nuevoId! } });
      data.tratamientoPrevisto = { connect: { id: nuevoId! } };
      data.montoAdelanto = montoAdelanto; // el plazo para pagar no cambia
      cambios.push(`Tratamiento previsto: «${c.tratamientoPrevisto?.nombre ?? '—'}» → «${nuevo.nombre}» (adelanto S/ ${c.montoAdelanto?.toFixed(2) ?? '0.00'} → S/ ${montoAdelanto.toFixed(2)})`);
    }
    if (cambios.length === 0) throw new ErrorNegocio(422, 'SIN_CAMBIOS', MENSAJES.SIN_CAMBIOS);
    await tx.cita.update({ where: { id: citaId }, data });
    await auditar(tx, { usuarioId, accion: 'editar_cita', pacienteId: c.pacienteId, detalle: `Cita #${citaId}. ${cambios.join('; ')}`, ip });
    return tx.cita.findUniqueOrThrow({ where: { id: citaId }, include: INCLUIR });
  });
  const { saldoFavor } = await prisma.paciente.findUniqueOrThrow({ where: { id: cita.pacienteId }, select: { saldoFavor: true } });
  return formatearCita(cita, saldoFavor);
}
