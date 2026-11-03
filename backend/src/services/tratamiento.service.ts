// Tarifario (CU-14 a CU-17). RN-08: todo tratamiento realizado existe aquí con su precio e insumos.
import { Prisma } from '@prisma/client';
import { MENSAJES, type TratamientoDTO } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';

const INCLUIR = { insumos: { include: { insumo: { select: { id: true, nombre: true, unidad: true, stockActual: true, stockMinimo: true, activo: true } } } } } as const;
type TratamientoCompleto = Prisma.TratamientoGetPayload<{ include: typeof INCLUIR }>;

const formatear = (t: TratamientoCompleto) => ({
  id: t.id,
  nombre: t.nombre,
  precio: t.precio.toFixed(2),
  activo: t.activo,
  insumos: t.insumos.map((i) => ({
    insumoId: i.insumoId,
    nombre: i.insumo.nombre,
    unidad: i.insumo.unidad,
    cantidad: i.cantidad.toFixed(2),
    stockActual: i.insumo.stockActual.toFixed(2),
    stockMinimo: i.insumo.stockMinimo.toFixed(2),
  })),
});

const noEncontrado = () => new ErrorNegocio(404, 'TRATAMIENTO_NO_ENCONTRADO', MENSAJES.TRATAMIENTO_NO_ENCONTRADO);

/** CU-15 Listar tarifario (búsqueda y filtro por estado). */
export async function listar(filtro: { q?: string; activo?: boolean }) {
  const lista = await prisma.tratamiento.findMany({
    where: {
      ...(filtro.activo !== undefined ? { activo: filtro.activo } : {}),
      ...(filtro.q ? { nombre: { contains: filtro.q, mode: 'insensitive' } } : {}),
    },
    orderBy: { nombre: 'asc' },
    include: INCLUIR,
  });
  return lista.map(formatear);
}

async function validarInsumos(tx: Tx, insumos: TratamientoDTO['insumos']) {
  if (insumos.length === 0) return;
  const encontrados = await tx.insumo.findMany({ where: { id: { in: insumos.map((i) => i.insumoId) } } });
  if (encontrados.length !== insumos.length) throw new ErrorNegocio(422, 'INSUMO_NO_ENCONTRADO', MENSAJES.INSUMO_NO_ENCONTRADO);
  if (encontrados.some((i) => !i.activo)) throw new ErrorNegocio(422, 'INSUMO_INACTIVO', MENSAJES.INSUMO_INACTIVO);
}

const duplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ErrorNegocio(409, 'TRATAMIENTO_DUPLICADO', MENSAJES.TRATAMIENTO_DUPLICADO, { nombre: MENSAJES.TRATAMIENTO_DUPLICADO })
    : e;

/** CU-14 Agregar tratamiento al tarifario con los insumos que consume. */
export async function crear(dto: TratamientoDTO) {
  try {
    return formatear(
      await prisma.$transaction(async (tx) => {
        await validarInsumos(tx, dto.insumos);
        return tx.tratamiento.create({
          data: { nombre: dto.nombre, precio: dto.precio, insumos: { create: dto.insumos } },
          include: INCLUIR,
        });
      }),
    );
  } catch (e) {
    throw duplicado(e);
  }
}

/**
 * CU-16 Modificar tratamiento. El cambio de precio solo afecta atenciones futuras:
 * las ya registradas guardan su precio congelado en atencion_tratamiento.precio_aplicado.
 */
export async function modificar(id: number, dto: TratamientoDTO) {
  try {
    return formatear(
      await prisma.$transaction(async (tx) => {
        if (!(await tx.tratamiento.findUnique({ where: { id } }))) throw noEncontrado();
        await validarInsumos(tx, dto.insumos);
        await tx.tratamientoInsumo.deleteMany({ where: { tratamientoId: id } });
        return tx.tratamiento.update({
          where: { id },
          data: { nombre: dto.nombre, precio: dto.precio, insumos: { create: dto.insumos } },
          include: INCLUIR,
        });
      }),
    );
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-17 Desactivar (borrado lógico). También permite reactivar. */
export async function cambiarEstado(id: number, activo: boolean) {
  if (!(await prisma.tratamiento.findUnique({ where: { id } }))) throw noEncontrado();
  if (activo) {
    // Al reactivar, sus insumos deben seguir activos
    const inactivos = await prisma.tratamientoInsumo.count({ where: { tratamientoId: id, insumo: { activo: false } } });
    if (inactivos > 0) throw new ErrorNegocio(422, 'INSUMO_INACTIVO', MENSAJES.INSUMO_INACTIVO);
  }
  return formatear(await prisma.tratamiento.update({ where: { id }, data: { activo }, include: INCLUIR }));
}
