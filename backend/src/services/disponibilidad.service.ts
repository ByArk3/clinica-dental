import { MENSAJES, type AlternativaOdontologo, type Disponibilidad } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ahoraLima, aHora, dateAHora, diaSemana, fechaADate, minutos, sumarDias } from '../lib/fechas.js';

export const ESTADOS_QUE_LIBERAN = ['cancelada', 'liberada'] as const; // igual que el índice parcial de RN-02
const DIAS_BUSQUEDA_SIGUIENTE = 60;

async function duracionBloque(db: Tx | typeof prisma) {
  const c = await db.configuracion.findUnique({ where: { clave: 'duracion_bloque_min' } });
  return Number(c?.valor ?? 30); // P5: bloques de 30 min
}

/** Nombre del feriado de esa fecha, o null. En feriado no se atiende. */
export async function feriadoEn(db: Tx | typeof prisma, fecha: string) {
  return (await db.feriado.findUnique({ where: { fecha: fechaADate(fecha) } }))?.nombre ?? null;
}

/**
 * Bloques del horario de atención de un odontólogo en una fecha (RN-03: su propio horario; en feriados no se atiende).
 * Usa el horario propio del odontólogo si lo tiene; si no, el horario general (odontologo_id NULL). P4/P5.
 */
export async function bloquesDelHorario(db: Tx | typeof prisma, odontologoId: number, fecha: string) {
  if (await feriadoEn(db, fecha)) return [];
  const dia = diaSemana(fecha);
  let tramos = await db.horarioAtencion.findMany({ where: { odontologoId, diaSemana: dia } });
  if (tramos.length === 0) {
    const propios = await db.horarioAtencion.count({ where: { odontologoId } });
    if (propios === 0) tramos = await db.horarioAtencion.findMany({ where: { odontologoId: null, diaSemana: dia } });
  }
  const duracion = await duracionBloque(db);
  const bloques: string[] = [];
  for (const t of tramos) {
    for (let m = minutos(dateAHora(t.horaInicio)); m + duracion <= minutos(dateAHora(t.horaFin)); m += duracion) {
      bloques.push(aHora(m));
    }
  }
  return [...new Set(bloques)].sort();
}

export async function horasOcupadas(db: Tx | typeof prisma, odontologoId: number, fecha: string, excluirCitaId?: number) {
  const citas = await db.cita.findMany({
    where: {
      odontologoId,
      fecha: fechaADate(fecha),
      estado: { notIn: [...ESTADOS_QUE_LIBERAN] },
      ...(excluirCitaId ? { id: { not: excluirCitaId } } : {}),
    },
    select: { hora: true },
  });
  return new Set(citas.map((c) => dateAHora(c.hora)));
}

/** Horarios libres = horario de atención − citas activas − horas pasadas. */
async function horariosLibres(odontologoId: number, fecha: string) {
  const bloques = await bloquesDelHorario(prisma, odontologoId, fecha);
  if (bloques.length === 0) return { atiende: false, horarios: [] as string[] };
  const ocupadas = await horasOcupadas(prisma, odontologoId, fecha);
  const ahora = ahoraLima();
  const libres = bloques.filter(
    (h) => !ocupadas.has(h) && (fecha > ahora.fecha || (fecha === ahora.fecha && h > ahora.hora)),
  );
  return { atiende: true, horarios: libres };
}

const DIAS_PLURAL = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];

/** Odontólogos activos (sirve para cualquier cantidad: se leen de la base, no hay nombres fijos). */
async function odontologosActivos(db: Tx | typeof prisma) {
  return db.odontologo.findMany({
    where: { activo: true, usuario: { activo: true } },
    select: { id: true, usuario: { select: { nombres: true } } },
    orderBy: { id: 'asc' },
  });
}

/**
 * Por qué no hay atención ese día con ese odontólogo (RN-03):
 * - si nadie de la clínica trabaja ese día → «La clínica no atiende ese día» (domingo, por ejemplo);
 * - si otros sí trabajan → «El Dr. X no atiende los sábados», para no dar a entender que la clínica cierra.
 */
export async function mensajeSinAtencion(db: Tx | typeof prisma, odontologoId: number, fecha: string) {
  const otros = (await odontologosActivos(db)).filter((o) => o.id !== odontologoId);
  for (const o of otros) {
    if ((await bloquesDelHorario(db, o.id, fecha)).length > 0) {
      const elegido = await db.odontologo.findUnique({ where: { id: odontologoId }, select: { usuario: { select: { nombres: true } } } });
      return MENSAJES.odontologoNoAtiende(elegido?.usuario.nombres ?? 'El odontólogo', DIAS_PLURAL[diaSemana(fecha)]);
    }
  }
  return MENSAJES.CLINICA_NO_ATIENDE;
}

/** Flujo alterno de CU-05: los demás odontólogos que sí tienen horarios libres ese día (todos los que haya). */
async function alternativas(odontologoId: number, fecha: string): Promise<AlternativaOdontologo[]> {
  const lista: AlternativaOdontologo[] = [];
  for (const o of await odontologosActivos(prisma)) {
    if (o.id === odontologoId) continue;
    const { horarios } = await horariosLibres(o.id, fecha);
    if (horarios.length > 0) lista.push({ odontologoId: o.id, nombres: o.usuario.nombres, primeraHora: horarios[0], libres: horarios.length });
  }
  return lista.sort((a, b) => a.primeraHora.localeCompare(b.primeraHora) || a.nombres.localeCompare(b.nombres));
}

/** CU-05 Consultar disponibilidad */
export async function consultarDisponibilidad(odontologoId: number, fecha: string): Promise<Disponibilidad> {
  const hoy = ahoraLima().fecha;
  if (fecha < hoy) {
    return { fecha, atiende: true, horarios: [], mensaje: MENSAJES.HORA_PASADA, siguienteFechaDisponible: await siguienteFecha(odontologoId, hoy) };
  }
  const { atiende, horarios } = await horariosLibres(odontologoId, fecha);
  if (horarios.length > 0) return { fecha, atiende, horarios };
  const feriado = await feriadoEn(prisma, fecha);
  if (feriado) {
    return { fecha, atiende, horarios, mensaje: `${MENSAJES.CLINICA_FERIADO}: ${feriado}`, siguienteFechaDisponible: await siguienteFecha(odontologoId, sumarDias(fecha, 1)) };
  }
  return {
    fecha,
    atiende,
    horarios,
    mensaje: atiende ? MENSAJES.SIN_HORARIOS : await mensajeSinAtencion(prisma, odontologoId, fecha),
    siguienteFechaDisponible: await siguienteFecha(odontologoId, sumarDias(fecha, 1)),
    alternativas: await alternativas(odontologoId, fecha),
  };
}

/** Flujo alterno: sin horarios → sugerir la siguiente fecha con disponibilidad. */
async function siguienteFecha(odontologoId: number, desde: string) {
  for (let i = 0; i < DIAS_BUSQUEDA_SIGUIENTE; i++) {
    const f = sumarDias(desde, i);
    if ((await horariosLibres(odontologoId, f)).horarios.length > 0) return f;
  }
  return null;
}
