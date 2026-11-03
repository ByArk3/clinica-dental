// CU-12 Actualizar stock (c_actualizarStock): ÚNICO punto que modifica insumos.stock_actual.
// Lo usan CU-11 (salida por tratamiento), CU-25 (ajuste/merma) y CU-33 (entrada por recepción),
// siempre DENTRO de su prisma.$transaction, recibiendo el cliente de transacción `tx`.
import { Prisma, type TipoMovimiento } from '@prisma/client';
import { MENSAJES } from '@clinica/shared';
import type { Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

/** Tipos que restan del stock; los demás suman. `ajuste` lleva el signo en la cantidad. */
const SALIDAS: TipoMovimiento[] = ['salida_tratamiento', 'merma'];

export interface Movimiento {
  insumoId: number;
  tipo: TipoMovimiento;
  /** Siempre positiva, salvo `ajuste`, donde el signo indica si suma (+) o resta (−). */
  cantidad: Prisma.Decimal.Value;
  usuarioId: number;
  motivo?: string;
  referencia?: { tipo: string; id: number };
}

export interface ResultadoMovimiento {
  insumoId: number;
  insumo: string;
  unidad: string;
  cantidad: string; // efectivamente aplicada (con signo)
  saldo: string;
  /** La salida pedía más de lo que había: se dejó en 0 y se registró una observación (CU-12). */
  faltante?: string;
  alertaGenerada: boolean;
}

export async function registrarMovimiento(tx: Tx, m: Movimiento): Promise<ResultadoMovimiento> {
  // Bloqueo de la fila: dos atenciones simultáneas no pueden leer el mismo saldo
  const [fila] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM insumos WHERE id = ${m.insumoId} FOR UPDATE`;
  if (!fila) throw new ErrorNegocio(404, 'INSUMO_NO_ENCONTRADO', MENSAJES.INSUMO_NO_ENCONTRADO);
  const insumo = await tx.insumo.findUniqueOrThrow({ where: { id: m.insumoId } });

  const cantidad = D(m.cantidad);
  let delta = SALIDAS.includes(m.tipo) ? cantidad.neg() : cantidad;
  let saldo = insumo.stockActual.plus(delta);
  let motivo = m.motivo;
  let faltante: Prisma.Decimal | undefined;

  // Una salida no puede dejar stock negativo: se deja en 0 y se anota la diferencia
  if (saldo.isNegative()) {
    faltante = saldo.neg();
    delta = insumo.stockActual.neg();
    saldo = D(0);
    const obs = `Stock insuficiente: faltaron ${faltante.toFixed(2)} ${insumo.unidad}`;
    motivo = motivo ? `${motivo}. ${obs}` : obs;
  }

  await tx.insumo.update({ where: { id: insumo.id }, data: { stockActual: saldo } });
  await tx.movimientoKardex.create({
    data: {
      insumoId: insumo.id,
      tipo: m.tipo,
      cantidad: delta,
      saldo,
      motivo,
      referenciaTipo: m.referencia?.tipo,
      referenciaId: m.referencia?.id,
      usuarioId: m.usuarioId,
    },
  });

  // RN-14: en stock mínimo → alerta. No se duplica mientras haya una alerta sin revisar.
  let alertaGenerada = false;
  if (saldo.lessThanOrEqualTo(insumo.stockMinimo)) {
    const abierta = await tx.alertaStock.findFirst({ where: { insumoId: insumo.id, revisada: false } });
    if (!abierta) {
      await tx.alertaStock.create({ data: { insumoId: insumo.id, stockAlGenerar: saldo } });
      alertaGenerada = true;
    }
  }

  return {
    insumoId: insumo.id,
    insumo: insumo.nombre,
    unidad: insumo.unidad,
    cantidad: delta.toFixed(2),
    saldo: saldo.toFixed(2),
    faltante: faltante?.toFixed(2),
    alertaGenerada,
  };
}
