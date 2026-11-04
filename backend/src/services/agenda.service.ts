// Feriados (días sin atención) y horario propio de cada odontólogo. Los gestiona el Administrador.
import { Prisma } from '@prisma/client';
import { HORARIO_CLINICA, MENSAJES, type HorarioDTO } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, dateAHora, fechaADate, horaADate, minutos } from '../lib/fechas.js';
import { ESTADOS_QUE_LIBERAN } from './disponibilidad.service.js';

// ---------- Feriados ----------
export async function listarFeriados(anio?: number) {
  const lista = await prisma.feriado.findMany({
    where: anio ? { fecha: { gte: fechaADate(`${anio}-01-01`), lte: fechaADate(`${anio}-12-31`) } } : {},
    orderBy: { fecha: 'asc' },
  });
  return lista.map((f) => ({ id: f.id, fecha: dateAFecha(f.fecha), nombre: f.nombre }));
}

/** Agrega un feriado y devuelve las citas activas de ese día, para que recepción las reprograme. */
export async function crearFeriado(fecha: string, nombre: string) {
  try {
    const f = await prisma.feriado.create({ data: { fecha: fechaADate(fecha), nombre } });
    const citas = await prisma.cita.findMany({
      where: { fecha: fechaADate(fecha), estado: { notIn: [...ESTADOS_QUE_LIBERAN, 'inasistencia', 'atendida', 'pagada'] } },
      orderBy: { hora: 'asc' },
      include: { paciente: { select: { nombres: true, apellidos: true, telefono: true } }, odontologo: { include: { usuario: { select: { nombres: true } } } } },
    });
    return {
      feriado: { id: f.id, fecha, nombre },
      citasAfectadas: citas.map((c) => ({
        id: c.id,
        hora: dateAHora(c.hora),
        paciente: `${c.paciente.nombres} ${c.paciente.apellidos}`,
        telefono: c.paciente.telefono,
        odontologo: c.odontologo.usuario.nombres,
        estado: c.estado,
      })),
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ErrorNegocio(409, 'FERIADO_DUPLICADO', MENSAJES.FERIADO_DUPLICADO, { fecha: MENSAJES.FERIADO_DUPLICADO });
    }
    throw e;
  }
}

export async function eliminarFeriado(id: number) {
  const r = await prisma.feriado.deleteMany({ where: { id } });
  if (r.count === 0) throw new ErrorNegocio(404, 'NO_ENCONTRADO', 'Feriado no encontrado');
}

// ---------- Horario de cada odontólogo ----------
export async function verHorario(odontologoId: number) {
  const o = await prisma.odontologo.findUnique({ where: { id: odontologoId }, include: { usuario: { select: { nombres: true } } } });
  if (!o) throw new ErrorNegocio(404, 'ODONTOLOGO_NO_DISPONIBLE', MENSAJES.ODONTOLOGO_NO_DISPONIBLE);
  const tramos = await prisma.horarioAtencion.findMany({ where: { odontologoId }, orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] });
  return {
    odontologoId,
    nombres: o.usuario.nombres,
    // Sin tramos propios se usa el horario general de la clínica
    usaHorarioGeneral: tramos.length === 0,
    tramos: tramos.map((t) => ({ diaSemana: t.diaSemana, horaInicio: dateAHora(t.horaInicio), horaFin: dateAHora(t.horaFin) })),
  };
}

/**
 * Reemplaza el horario semanal del odontólogo. Reglas: lunes a sábado, dentro de 08:00–20:00,
 * en múltiplos de 30 min, inicio < fin y sin tramos que se crucen el mismo día.
 * Las citas ya registradas no se tocan.
 */
export async function guardarHorario(odontologoId: number, d: HorarioDTO) {
  if (!(await prisma.odontologo.findUnique({ where: { id: odontologoId } }))) {
    throw new ErrorNegocio(404, 'ODONTOLOGO_NO_DISPONIBLE', MENSAJES.ODONTOLOGO_NO_DISPONIBLE);
  }
  const invalido = (msg: string) => new ErrorNegocio(422, 'HORARIO_INVALIDO', `${MENSAJES.HORARIO_INVALIDO}: ${msg}`);
  const apertura = minutos(HORARIO_CLINICA.apertura);
  const cierre = minutos(HORARIO_CLINICA.cierre);
  for (const t of d.tramos) {
    if (!(HORARIO_CLINICA.dias as readonly number[]).includes(t.diaSemana)) throw invalido('la clínica atiende de lunes a sábado');
    const a = minutos(t.horaInicio);
    const b = minutos(t.horaFin);
    if (a >= b) throw invalido('la hora de inicio debe ser anterior a la de fin');
    if (a < apertura || b > cierre) throw invalido(`debe estar entre ${HORARIO_CLINICA.apertura} y ${HORARIO_CLINICA.cierre}`);
    if (a % 30 !== 0 || b % 30 !== 0) throw invalido('use horas en punto o y media (bloques de 30 min)');
  }
  for (const dia of new Set(d.tramos.map((t) => t.diaSemana))) {
    const del = d.tramos.filter((t) => t.diaSemana === dia).sort((x, y) => minutos(x.horaInicio) - minutos(y.horaInicio));
    for (let i = 1; i < del.length; i++) {
      if (minutos(del[i].horaInicio) < minutos(del[i - 1].horaFin)) throw invalido('hay tramos que se cruzan el mismo día');
    }
  }
  await prisma.$transaction([
    prisma.horarioAtencion.deleteMany({ where: { odontologoId } }),
    prisma.horarioAtencion.createMany({
      data: d.tramos.map((t) => ({ odontologoId, diaSemana: t.diaSemana, horaInicio: horaADate(t.horaInicio), horaFin: horaADate(t.horaFin) })),
    }),
  ]);
  return verHorario(odontologoId);
}
