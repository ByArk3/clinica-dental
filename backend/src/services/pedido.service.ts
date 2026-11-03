// Pedidos: CU-30 Registrar, CU-31 Listar, CU-32 Anular, CU-33 Registrar recepción. RN-13, RN-15.
import { Prisma, type EstadoPedido } from '@prisma/client';
import { MENSAJES, type PedidoDTO, type RecepcionDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { registrarMovimiento } from './stock.service.js';

const INCLUIR = {
  proveedor: true,
  registradoPor: { select: { nombres: true } },
  detalles: { include: { insumo: { select: { nombre: true, unidad: true, stockActual: true } } }, orderBy: { id: 'asc' as const } },
} as const;
export type PedidoCompleto = Prisma.PedidoGetPayload<{ include: typeof INCLUIR }>;

const noEncontrado = () => new ErrorNegocio(404, 'PEDIDO_NO_ENCONTRADO', MENSAJES.PEDIDO_NO_ENCONTRADO);
const noPendiente = () => new ErrorNegocio(409, 'PEDIDO_NO_PENDIENTE', MENSAJES.PEDIDO_NO_PENDIENTE);

function formatear(p: PedidoCompleto) {
  return {
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
    fecha: p.createdAt.toISOString(),
    recibidoEn: p.recibidoEn?.toISOString() ?? null,
    motivoAnulacion: p.motivoAnulacion,
    observacionRecepcion: p.observacionRecepcion,
    registradoPor: p.registradoPor.nombres,
    proveedor: { id: p.proveedor.id, ruc: p.proveedor.ruc, razonSocial: p.proveedor.razonSocial, email: p.proveedor.email },
    detalles: p.detalles.map((d) => ({
      id: d.id,
      insumoId: d.insumoId,
      insumo: d.insumo.nombre,
      unidad: d.insumo.unidad,
      stockActual: d.insumo.stockActual.toFixed(2),
      cantidadPedida: d.cantidadPedida.toFixed(2),
      cantidadRecibida: d.cantidadRecibida?.toFixed(2) ?? null,
    })),
  };
}

export async function obtener(id: number) {
  const p = await prisma.pedido.findUnique({ where: { id }, include: INCLUIR });
  if (!p) throw noEncontrado();
  return p;
}
export const ver = async (id: number) => formatear(await obtener(id));

/** CU-31 Listar pedidos (filtro por estado, proveedor o código). */
export async function listar(f: { estado?: EstadoPedido; q?: string }) {
  const lista = await prisma.pedido.findMany({
    where: {
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.q
        ? { OR: [{ codigo: { contains: f.q, mode: 'insensitive' } }, { proveedor: { razonSocial: { contains: f.q, mode: 'insensitive' } } }] }
        : {}),
    },
    orderBy: { id: 'desc' },
    take: 200,
    include: INCLUIR,
  });
  return lista.map(formatear);
}

/**
 * CU-30 Registrar pedido: proveedor activo (3.1), ≥ 1 insumo activo con cantidad > 0 (8.1),
 * código correlativo PED-0001. El stock NO cambia hasta la recepción (CU-33).
 */
export async function registrar(d: PedidoDTO, usuario: UsuarioSesion) {
  const id = await prisma.$transaction(async (tx) => {
    const proveedor = await tx.proveedor.findUnique({ where: { id: d.proveedorId } });
    if (!proveedor?.activo) throw new ErrorNegocio(422, 'PROVEEDOR_INACTIVO', MENSAJES.PROVEEDOR_INACTIVO, { proveedorId: MENSAJES.PROVEEDOR_INACTIVO });
    const insumos = await tx.insumo.findMany({ where: { id: { in: d.insumos.map((i) => i.insumoId) }, activo: true } });
    if (insumos.length !== d.insumos.length) throw new ErrorNegocio(422, 'INSUMO_INACTIVO', MENSAJES.INSUMO_INACTIVO);

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(130030)`; // correlativo sin huecos
    const n = (await tx.pedido.count()) + 1;
    const pedido = await tx.pedido.create({
      data: {
        codigo: `PED-${String(n).padStart(4, '0')}`,
        proveedorId: proveedor.id,
        registradoPorId: usuario.id,
        detalles: { create: d.insumos.map((i) => ({ insumoId: i.insumoId, cantidadPedida: i.cantidad })) },
      },
    });
    return pedido.id;
  });
  return ver(id);
}

/** CU-32 Anular pedido (RN-13: solo el Administrador, con motivo). */
export async function anular(id: number, motivo: string) {
  const p = await prisma.pedido.findUnique({ where: { id } });
  if (!p) throw noEncontrado();
  const r = await prisma.pedido.updateMany({ where: { id, estado: 'pendiente' }, data: { estado: 'anulado', motivoAnulacion: motivo } });
  if (r.count === 0) throw noPendiente();
  return ver(id);
}

/**
 * CU-33 Registrar recepción. RN-15: lo recibido se suma al stock solo tras verificar contra el pedido.
 * En UNA transacción: cantidades recibidas, una entrada de kárdex por insumo recibido (CU-12) y estado del pedido.
 * 6.1: si hay diferencias, la observación es obligatoria y el estado es «Recibido con diferencias».
 */
export async function registrarRecepcion(id: number, d: RecepcionDTO, usuario: UsuarioSesion) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pedidos WHERE id = ${id} FOR UPDATE`;
    const pedido = await tx.pedido.findUnique({ where: { id }, include: { detalles: true } });
    if (!pedido) throw noEncontrado();
    if (pedido.estado !== 'pendiente') throw noPendiente();

    const recibido = new Map(d.items.map((i) => [i.detalleId, new Prisma.Decimal(i.cantidadRecibida)]));
    if (recibido.size !== pedido.detalles.length || pedido.detalles.some((det) => !recibido.has(det.id))) {
      throw new ErrorNegocio(422, 'RECEPCION_INCOMPLETA', MENSAJES.RECEPCION_INCOMPLETA);
    }
    const conDiferencias = pedido.detalles.some((det) => !recibido.get(det.id)!.equals(det.cantidadPedida));
    if (conDiferencias && !d.observacion) {
      throw new ErrorNegocio(422, 'OBSERVACION_REQUERIDA', MENSAJES.OBSERVACION_REQUERIDA, { observacion: MENSAJES.OBSERVACION_REQUERIDA });
    }

    for (const det of pedido.detalles) {
      const cantidad = recibido.get(det.id)!;
      await tx.detallePedido.update({ where: { id: det.id }, data: { cantidadRecibida: cantidad } });
      if (cantidad.greaterThan(0)) {
        await registrarMovimiento(tx, {
          insumoId: det.insumoId,
          tipo: 'entrada_recepcion',
          cantidad, // solo lo realmente recibido
          usuarioId: usuario.id,
          motivo: `Recepción del pedido ${pedido.codigo}`,
          referencia: { tipo: 'pedido', id: pedido.id },
        });
      }
    }
    await tx.pedido.update({
      where: { id },
      data: {
        estado: conDiferencias ? 'recibido_con_diferencias' : 'recibido',
        observacionRecepcion: d.observacion ?? null,
        recibidoEn: new Date(),
      },
    });
  });
  return ver(id);
}
