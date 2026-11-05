// Saldo a favor del paciente: libro de movimientos + acumulado en pacientes.saldo_favor.
// Cada abono tiene vigencia (Configuración → Pagos, 12 meses por defecto; 0 = no vence) y se usa primero lo más antiguo.
import { Prisma, type TipoMovimientoSaldo } from '@prisma/client';
import { MESES_VIGENCIA_SALDO } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function mesesVigencia(db: Tx | typeof prisma = prisma) {
  const f = await db.configuracion.findUnique({ where: { clave: 'saldo_vigencia_meses' } });
  const n = Number(f?.valor ?? MESES_VIGENCIA_SALDO);
  return Number.isInteger(n) && n >= 0 ? n : MESES_VIGENCIA_SALDO;
}

const sumarMeses = (d: Date, meses: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + meses);
  return r;
};

/**
 * Mueve el saldo: monto > 0 = abono (con su vigencia), monto < 0 = uso (descuenta de los abonos más antiguos).
 * Bloquea la fila del paciente: dos cobros simultáneos no usan el mismo saldo. El CHECK impide quedar en negativo.
 */
export async function moverSaldo(
  tx: Tx,
  m: { pacienteId: number; tipo: TipoMovimientoSaldo; monto: Prisma.Decimal.Value; usuarioId: number; citaId?: number; comprobanteId?: number; motivo?: string },
) {
  const monto = D(m.monto);
  if (monto.isZero()) return null;
  await tx.$queryRaw`SELECT id FROM pacientes WHERE id = ${m.pacienteId} FOR UPDATE`;
  const p = await tx.paciente.update({ where: { id: m.pacienteId }, data: { saldoFavor: { increment: monto } } });

  let extra: { restante?: Prisma.Decimal; venceEn?: Date | null } = {};
  if (monto.isPositive()) {
    const meses = await mesesVigencia(tx);
    extra = { restante: monto, venceEn: meses > 0 ? sumarMeses(new Date(), meses) : null };
  } else {
    await consumirAbonos(tx, m.pacienteId, monto.neg());
  }
  return tx.saldoMovimiento.create({
    data: { pacienteId: m.pacienteId, tipo: m.tipo, monto, saldo: p.saldoFavor, citaId: m.citaId, comprobanteId: m.comprobanteId, motivo: m.motivo, usuarioId: m.usuarioId, ...extra },
  });
}

/** Descuenta `cantidad` de los abonos con saldo, del que vence primero al último (los que no vencen, al final). */
async function consumirAbonos(tx: Tx, pacienteId: number, cantidad: Prisma.Decimal) {
  const abonos = await tx.saldoMovimiento.findMany({
    where: { pacienteId, restante: { gt: 0 } },
    orderBy: [{ venceEn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  });
  let falta = cantidad;
  for (const a of abonos) {
    if (falta.lessThanOrEqualTo(0)) break;
    const usa = Prisma.Decimal.min(a.restante!, falta);
    await tx.saldoMovimiento.update({ where: { id: a.id }, data: { restante: a.restante!.minus(usa) } });
    falta = falta.minus(usa);
  }
}

/** Próximos vencimientos del saldo de un paciente (para «Mis datos» y Caja). */
export async function vencimientos(db: Tx | typeof prisma, pacienteId: number) {
  const abonos = await db.saldoMovimiento.findMany({
    where: { pacienteId, restante: { gt: 0 }, venceEn: { not: null } },
    orderBy: [{ venceEn: 'asc' }, { id: 'asc' }],
    select: { restante: true, venceEn: true },
  });
  return abonos.map((a) => ({ monto: a.restante!.toFixed(2), venceEn: a.venceEn!.toISOString() }));
}

/**
 * Tarea programada: los abonos cuya vigencia terminó dejan de estar disponibles (movimiento «vencimiento»).
 * Devuelve cuántos abonos vencieron.
 */
export async function vencerSaldos(ahora = new Date()) {
  const vencidos = await prisma.saldoMovimiento.findMany({ where: { restante: { gt: 0 }, venceEn: { lte: ahora } }, select: { id: true, pacienteId: true } });
  const sistema = await prisma.usuario.findFirst({ where: { rol: 'administrador' }, orderBy: { id: 'asc' }, select: { id: true } });
  if (!sistema) return 0;
  for (const v of vencidos) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pacientes WHERE id = ${v.pacienteId} FOR UPDATE`;
      const a = await tx.saldoMovimiento.findUniqueOrThrow({ where: { id: v.id } });
      if (!a.restante || a.restante.lessThanOrEqualTo(0)) return;
      const p = await tx.paciente.update({ where: { id: a.pacienteId }, data: { saldoFavor: { decrement: a.restante } } });
      await tx.saldoMovimiento.update({ where: { id: a.id }, data: { restante: 0 } });
      await tx.saldoMovimiento.create({
        data: { pacienteId: a.pacienteId, tipo: 'vencimiento', monto: a.restante.neg(), saldo: p.saldoFavor, usuarioId: sistema.id, motivo: `Venció el saldo generado el ${a.createdAt.toISOString().slice(0, 10)}` },
      });
    });
  }
  return vencidos.length;
}

/** Abonos que vencen dentro de `dias` días y aún no recibieron ese aviso (o uno más cercano). */
export async function porAvisar(dias: 30 | 7, ahora = new Date()) {
  return prisma.saldoMovimiento.findMany({
    where: {
      restante: { gt: 0 },
      venceEn: { gt: ahora, lte: new Date(ahora.getTime() + dias * 86_400_000) },
      OR: [{ avisoDias: null }, { avisoDias: { gt: dias } }],
    },
    include: { paciente: { select: { nombres: true, email: true } } },
  });
}

export async function movimientos(tx: Tx, pacienteId: number) {
  const lista = await tx.saldoMovimiento.findMany({ where: { pacienteId }, orderBy: { id: 'desc' }, take: 50 });
  return lista.map((m) => ({ id: m.id, fecha: m.createdAt.toISOString(), tipo: m.tipo, monto: m.monto.toFixed(2), saldo: m.saldo.toFixed(2), motivo: m.motivo }));
}
