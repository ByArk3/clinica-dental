// Precios con campañas de descuento. Reglas acordadas:
//  · La campaña vale según la FECHA DE LA CITA (así el adelanto y el cobro final usan el mismo precio).
//  · Aplica a los tratamientos de la campaña y, si tiene edad máxima, solo a pacientes de esa edad o menos.
//  · Si dos campañas aplican a la misma línea, gana la de mayor descuento (no se suman).
//  · 3x2: entre las líneas del grupo, cada tercera (la de menor precio) sale gratis.
import { Prisma } from '@prisma/client';
import { PORCENTAJE_ADELANTO } from '@clinica/shared';
import type { Tx } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { fechaADate } from '../lib/fechas.js';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const redondear = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
type Db = Tx | typeof prisma;

/** Edad cumplida en una fecha (aaaa-mm-dd). */
export function edadEn(fechaNacimiento: Date, fecha: string) {
  const n = fechaNacimiento.toISOString().slice(0, 10);
  let edad = Number(fecha.slice(0, 4)) - Number(n.slice(0, 4));
  if (fecha.slice(5) < n.slice(5)) edad -= 1;
  return edad;
}

/** Campañas activas que cubren la fecha y la edad del paciente. */
export async function campanasVigentes(db: Db, fecha: string, edad: number) {
  const dia = fechaADate(fecha);
  const lista = await db.descuento.findMany({
    where: { activo: true, fechaInicio: { lte: dia }, fechaFin: { gte: dia } },
    include: { tratamientos: { select: { tratamientoId: true } } },
    orderBy: { id: 'asc' },
  });
  return lista
    .filter((c) => c.edadMaxima === null || edad <= c.edadMaxima)
    .map((c) => ({ ...c, ids: new Set(c.tratamientos.map((t) => t.tratamientoId)) }));
}

export interface LineaPrecio {
  tratamientoId: number | null;
  precio: Prisma.Decimal.Value;
}
export interface DescuentoLinea {
  descuento: Prisma.Decimal;
  descuentoId: number | null;
  campana: string | null;
}

/** Descuento de campaña de cada línea (mismo orden que `lineas`). */
export async function aplicarCampanas(db: Db, lineas: LineaPrecio[], fecha: string, edad: number): Promise<DescuentoLinea[]> {
  const campanas = await campanasVigentes(db, fecha, edad);
  const mejor: DescuentoLinea[] = lineas.map(() => ({ descuento: D(0), descuentoId: null, campana: null }));
  const proponer = (i: number, desc: Prisma.Decimal, c: { id: number; nombre: string }) => {
    if (desc.greaterThan(mejor[i].descuento)) mejor[i] = { descuento: desc, descuentoId: c.id, campana: c.nombre };
  };

  for (const c of campanas) {
    const elegibles = lineas
      .map((l, i) => ({ i, precio: D(l.precio), id: l.tratamientoId }))
      .filter((l) => l.id !== null && c.ids.has(l.id));
    if (c.tipo === 'porcentaje' && c.porcentaje) {
      for (const l of elegibles) proponer(l.i, redondear(l.precio.times(c.porcentaje).dividedBy(100)), c);
    } else if (c.tipo === 'tres_por_dos') {
      // De mayor a menor precio: la 3.ª, 6.ª, … (las más baratas de cada trío) salen gratis
      elegibles.sort((a, b) => b.precio.comparedTo(a.precio) || a.i - b.i);
      elegibles.forEach((l, k) => {
        if (k % 3 === 2) proponer(l.i, l.precio, c);
      });
    }
  }
  return mejor;
}

/**
 * Adelanto = 50 % (100 % con 3+ inasistencias) del precio del tratamiento previsto, con la campaña vigente
 * el día de la cita. (Un 3x2 no aplica a una sola unidad.)
 */
export async function calcularAdelanto(db: Db, tratamientoId: number, fecha: string, edad: number, porcentaje: number = PORCENTAJE_ADELANTO) {
  const t = await db.tratamiento.findUniqueOrThrow({ where: { id: tratamientoId } });
  const [d] = await aplicarCampanas(db, [{ tratamientoId, precio: t.precio }], fecha, edad);
  return redondear(t.precio.minus(d.descuento).times(porcentaje).dividedBy(100));
}
