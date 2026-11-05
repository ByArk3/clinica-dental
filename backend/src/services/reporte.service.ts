// CU-38 Panel de control · CU-39 Reporte de ingresos · CU-40 Reporte de inventario (Administrador).
// Todas las fechas se agrupan en hora de Lima (created_at se guarda en UTC sin zona: convertir UTC → Lima). Montos en soles con 2 decimales (texto, para no perder precisión).
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ahoraLima, sumarDias } from '../lib/fechas.js';

const LIMA = 'America/Lima';
const D2 = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);
/** [inicio, fin) en UTC del rango de días locales de Lima, ambos inclusive. */
const rango = (desde: string, hasta: string) => ({
  gte: new Date(`${desde}T00:00:00-05:00`),
  lt: new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000),
});

/** CU-38 Panel de control: lo que el Administrador necesita ver al entrar. */
export async function panel() {
  const hoy = ahoraLima().fecha;
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const fechaHoy = new Date(`${hoy}T00:00:00Z`);

  const [citasHoy, ingresosHoy, ingresosMes, alertas, pedidosPendientes, adelantosPorPagar, inasistenciasMes, restringidos, serie, pagosPorVerificar, devHoy, devMes] = await Promise.all([
    prisma.cita.groupBy({ by: ['estado'], where: { fecha: fechaHoy }, _count: true }),
    prisma.comprobante.aggregate({ where: { createdAt: rango(hoy, hoy), anuladoEn: null }, _sum: { total: true }, _count: true }),
    prisma.comprobante.aggregate({ where: { createdAt: rango(inicioMes, hoy), anuladoEn: null }, _sum: { total: true }, _count: true }),
    prisma.alertaStock.findMany({ where: { revisada: false }, include: { insumo: { select: { nombre: true, stockActual: true, stockMinimo: true, unidad: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.pedido.count({ where: { estado: 'pendiente' } }),
    // toda reserva paga adelanto: las que aún no lo pagan (el horario se libera si no pagan en 1 hora)
    prisma.cita.count({ where: { estado: 'pendiente_adelanto', fecha: { gte: fechaHoy } } }),
    prisma.cita.count({ where: { estado: 'inasistencia', fecha: { gte: new Date(`${inicioMes}T00:00:00Z`), lte: fechaHoy } } }),
    prisma.paciente.count({ where: { restringido: true } }),
    prisma.$queryRaw<{ dia: Date; total: Prisma.Decimal }[]>`
      SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${LIMA})::date AS dia, SUM(total) AS total
        FROM comprobantes
       WHERE created_at >= ${rango(sumarDias(hoy, -6), hoy).gte} AND anulado_en IS NULL
       GROUP BY 1 ORDER BY 1`,
    prisma.cita.count({ where: { estado: 'pago_en_verificacion' } }),
    prisma.devolucion.aggregate({ where: { createdAt: rango(hoy, hoy) }, _sum: { monto: true } }),
    prisma.devolucion.aggregate({ where: { createdAt: rango(inicioMes, hoy) }, _sum: { monto: true } }),
  ]);

  const porDia = new Map(serie.map((s) => [s.dia.toISOString().slice(0, 10), D2(s.total)]));
  return {
    fecha: hoy,
    citasHoy: {
      total: citasHoy.reduce((s, c) => s + c._count, 0),
      porEstado: Object.fromEntries(citasHoy.map((c) => [c.estado, c._count])),
    },
    ingresos: {
      // neto: cobros − devoluciones de adelantos
      hoy: D2(new Prisma.Decimal(ingresosHoy._sum.total ?? 0).minus(devHoy._sum.monto ?? 0)),
      comprobantesHoy: ingresosHoy._count,
      mes: D2(new Prisma.Decimal(ingresosMes._sum.total ?? 0).minus(devMes._sum.monto ?? 0)),
      comprobantesMes: ingresosMes._count,
      ultimos7Dias: Array.from({ length: 7 }, (_, i) => {
        const f = sumarDias(hoy, i - 6);
        return { fecha: f, total: porDia.get(f) ?? '0.00' };
      }),
    },
    inventario: {
      alertasPendientes: alertas.length,
      alertas: alertas.slice(0, 8).map((a) => ({ id: a.id, insumo: a.insumo.nombre, unidad: a.insumo.unidad, stockActual: D2(a.insumo.stockActual), stockMinimo: D2(a.insumo.stockMinimo) })),
      pedidosPendientes,
    },
    agenda: { adelantosPorPagar, inasistenciasMes, pacientesRestringidos: restringidos, pagosPorVerificar },
  };
}

/** CU-39 Reporte de ingresos del rango (por tipo de pago, por día, por tratamiento y detalle de comprobantes). */
export async function ingresos(desde: string, hasta: string) {
  const r = rango(desde, hasta);
  const devoluciones = await prisma.devolucion.findMany({ where: { createdAt: r }, include: { paciente: { select: { nombres: true, apellidos: true } } }, orderBy: { id: 'asc' } });
  const todos = await prisma.comprobante.findMany({
    where: { createdAt: r },
    orderBy: { id: 'asc' },
    include: {
      paciente: { select: { dni: true, nombres: true, apellidos: true } },
      tipoPago: true,
      detalles: { include: { tratamiento: { select: { nombre: true } } } },
      anuladoPor: { select: { nombres: true } },
    },
  });
  // Los anulados aparecen en el detalle (con su motivo) pero no suman en los ingresos
  const comprobantes = todos.filter((c) => !c.anuladoEn);

  const cero = () => new Prisma.Decimal(0);
  let total = cero(), descuentos = cero(), adelantos = cero();
  const porTipoPago = new Map<string, { total: Prisma.Decimal; cantidad: number }>();
  const porDia = new Map<string, Prisma.Decimal>();
  const porTratamiento = new Map<string, { cantidad: number; importe: Prisma.Decimal }>();
  const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: LIMA });

  for (const c of comprobantes) {
    total = total.plus(c.total);
    descuentos = descuentos.plus(c.descuento);
    if (c.tipo === 'adelanto') adelantos = adelantos.plus(c.total);
    const tp = porTipoPago.get(c.tipoPago.nombre) ?? { total: cero(), cantidad: 0 };
    porTipoPago.set(c.tipoPago.nombre, { total: tp.total.plus(c.total), cantidad: tp.cantidad + 1 });
    const dia = fmtDia.format(c.createdAt);
    porDia.set(dia, (porDia.get(dia) ?? cero()).plus(c.total));
    for (const d of c.detalles) {
      if (!d.tratamiento) continue;
      const t = porTratamiento.get(d.tratamiento.nombre) ?? { cantidad: 0, importe: cero() };
      porTratamiento.set(d.tratamiento.nombre, { cantidad: t.cantidad + 1, importe: t.importe.plus(d.precio) });
    }
  }

  return {
    desde,
    hasta,
    resumen: {
      // total neto = cobrado − devoluciones de adelantos (citas canceladas por la clínica)
      total: D2(total.minus(devoluciones.reduce((s, d) => s.plus(d.monto), cero()))),
      cobrado: D2(total),
      devoluciones: D2(devoluciones.reduce((s, d) => s.plus(d.monto), cero())),
      saldoAplicado: D2(comprobantes.reduce((s, c) => s.plus(c.saldoAplicado), cero())),
      comprobantes: comprobantes.length,
      anulados: todos.length - comprobantes.length,
      ticketPromedio: comprobantes.length ? D2(total.dividedBy(comprobantes.length)) : '0.00',
      descuentos: D2(descuentos),
      adelantos: D2(adelantos),
    },
    porTipoPago: [...porTipoPago].map(([tipo, v]) => ({ tipo, total: D2(v.total), cantidad: v.cantidad })).sort((a, b) => Number(b.total) - Number(a.total)),
    porDia: [...porDia].map(([fecha, v]) => ({ fecha, total: D2(v) })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    // Importe bruto según tarifario (antes de descuentos y adelantos)
    porTratamiento: [...porTratamiento].map(([tratamiento, v]) => ({ tratamiento, cantidad: v.cantidad, importe: D2(v.importe) })).sort((a, b) => Number(b.importe) - Number(a.importe)),
    devolucionesDetalle: devoluciones.map((d) => ({ fecha: d.createdAt.toISOString(), paciente: `${d.paciente.apellidos}, ${d.paciente.nombres}`, monto: D2(d.monto), motivo: d.motivo })),
    detalle: todos.map((c) => ({
      id: c.id,
      numero: c.numero,
      fecha: c.createdAt.toISOString(),
      tipo: c.tipo,
      paciente: `${c.paciente.apellidos}, ${c.paciente.nombres}`,
      dni: c.paciente.dni,
      tipoPago: c.tipoPago.nombre,
      subtotal: D2(c.subtotal),
      descuento: D2(c.descuento),
      adelantoAplicado: D2(c.adelantoAplicado),
      total: D2(c.total),
      anulado: c.anuladoEn ? { fecha: c.anuladoEn.toISOString(), por: c.anuladoPor?.nombres ?? '', motivo: c.motivoAnulacion ?? '' } : null,
    })),
  };
}

/** CU-40 Reporte de inventario: stock actual vs mínimo y movimientos del rango por insumo. */
export async function inventario(desde: string, hasta: string) {
  const r = rango(desde, hasta);
  const [insumos, movs, pedidos] = await Promise.all([
    prisma.insumo.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.movimientoKardex.groupBy({ by: ['insumoId', 'tipo'], where: { createdAt: r }, _sum: { cantidad: true } }),
    prisma.pedido.groupBy({ by: ['estado'], where: { createdAt: r }, _count: true }),
  ]);
  const suma = (insumoId: number, tipos: string[]) =>
    movs.filter((m) => m.insumoId === insumoId && tipos.includes(m.tipo)).reduce((s, m) => s.plus(m._sum.cantidad ?? 0), new Prisma.Decimal(0));

  const filas = insumos.map((i) => ({
    id: i.id,
    nombre: i.nombre,
    unidad: i.unidad,
    activo: i.activo,
    stockActual: D2(i.stockActual),
    stockMinimo: D2(i.stockMinimo),
    bajoMinimo: i.stockActual.lessThanOrEqualTo(i.stockMinimo),
    entradas: D2(suma(i.id, ['entrada_recepcion', 'inicial'])),
    consumo: D2(suma(i.id, ['salida_tratamiento']).abs()),
    ajustes: D2(suma(i.id, ['ajuste'])),
    mermas: D2(suma(i.id, ['merma']).abs()),
  }));
  return {
    desde,
    hasta,
    resumen: {
      insumosActivos: filas.filter((f) => f.activo).length,
      bajoMinimo: filas.filter((f) => f.activo && f.bajoMinimo).length,
      pedidos: Object.fromEntries(pedidos.map((p) => [p.estado, p._count])),
    },
    insumos: filas,
  };
}

/** CSV con separador «;» y BOM (Excel en español lo abre bien). */
export function aCsv(cabecera: string[], filas: (string | number | boolean | null)[][]) {
  const celda = (v: string | number | boolean | null) => {
    const s = v === null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cabecera, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
}
