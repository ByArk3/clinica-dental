// Saldo a favor del paciente: libro de movimientos + acumulado en pacientes.saldo_favor.
import { Prisma, type TipoMovimientoSaldo } from '@prisma/client';
import type { Tx } from '../lib/prisma.js';

export async function moverSaldo(
  tx: Tx,
  m: { pacienteId: number; tipo: TipoMovimientoSaldo; monto: Prisma.Decimal.Value; usuarioId: number; citaId?: number; comprobanteId?: number; motivo?: string },
) {
  const monto = new Prisma.Decimal(m.monto);
  if (monto.isZero()) return null;
  // Bloqueo de la fila del paciente: dos cobros simultáneos no usan el mismo saldo
  await tx.$queryRaw`SELECT id FROM pacientes WHERE id = ${m.pacienteId} FOR UPDATE`;
  const p = await tx.paciente.update({ where: { id: m.pacienteId }, data: { saldoFavor: { increment: monto } } });
  // CHECK pacientes_saldo_no_negativo impide quedar en negativo
  return tx.saldoMovimiento.create({
    data: { pacienteId: m.pacienteId, tipo: m.tipo, monto, saldo: p.saldoFavor, citaId: m.citaId, comprobanteId: m.comprobanteId, motivo: m.motivo, usuarioId: m.usuarioId },
  });
}

export async function movimientos(tx: Tx, pacienteId: number) {
  const lista = await tx.saldoMovimiento.findMany({ where: { pacienteId }, orderBy: { id: 'desc' }, take: 50 });
  return lista.map((m) => ({ id: m.id, fecha: m.createdAt.toISOString(), tipo: m.tipo, monto: m.monto.toFixed(2), saldo: m.saldo.toFixed(2), motivo: m.motivo }));
}
