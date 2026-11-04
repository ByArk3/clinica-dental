// Campañas de descuento (fechas + tratamientos + edad máxima). Administrador.
import { Prisma } from '@prisma/client';
import { MENSAJES, type DescuentoDTO } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, fechaADate } from '../lib/fechas.js';

const INCLUIR = { tratamientos: { include: { tratamiento: { select: { id: true, nombre: true } } } } } as const;
const formatear = (d: Prisma.DescuentoGetPayload<{ include: typeof INCLUIR }>) => ({
  id: d.id,
  nombre: d.nombre,
  tipo: d.tipo,
  porcentaje: d.porcentaje?.toFixed(2) ?? null,
  fechaInicio: dateAFecha(d.fechaInicio),
  fechaFin: dateAFecha(d.fechaFin),
  edadMaxima: d.edadMaxima,
  activo: d.activo,
  tratamientos: d.tratamientos.map((t) => ({ id: t.tratamiento.id, nombre: t.tratamiento.nombre })),
});
const duplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ErrorNegocio(409, 'DESCUENTO_DUPLICADO', 'Ya existe una campaña con ese nombre', { nombre: 'Ya existe una campaña con ese nombre' })
    : e;
const existe = async (id: number) => {
  if (!(await prisma.descuento.findUnique({ where: { id } }))) throw new ErrorNegocio(404, 'DESCUENTO_NO_VALIDO', MENSAJES.DESCUENTO_NO_VALIDO);
};
const datos = (d: DescuentoDTO) => ({
  nombre: d.nombre,
  tipo: d.tipo,
  porcentaje: d.tipo === 'porcentaje' ? d.porcentaje : null,
  fechaInicio: fechaADate(d.fechaInicio),
  fechaFin: fechaADate(d.fechaFin),
  edadMaxima: d.edadMaxima ?? null,
});
async function validarTratamientos(ids: number[]) {
  if ((await prisma.tratamiento.count({ where: { id: { in: ids } } })) !== new Set(ids).size) {
    throw new ErrorNegocio(422, 'TRATAMIENTO_NO_ENCONTRADO', MENSAJES.TRATAMIENTO_NO_ENCONTRADO, { tratamientos: MENSAJES.TRATAMIENTO_NO_ENCONTRADO });
  }
}

export const listar = async () =>
  (await prisma.descuento.findMany({ orderBy: [{ fechaInicio: 'asc' }, { nombre: 'asc' }], include: INCLUIR })).map(formatear);

export async function crear(d: DescuentoDTO) {
  await validarTratamientos(d.tratamientos);
  try {
    return formatear(
      await prisma.descuento.create({ data: { ...datos(d), tratamientos: { create: [...new Set(d.tratamientos)].map((tratamientoId) => ({ tratamientoId })) } }, include: INCLUIR }),
    );
  } catch (e) {
    throw duplicado(e);
  }
}
export async function modificar(id: number, d: DescuentoDTO) {
  await existe(id);
  await validarTratamientos(d.tratamientos);
  try {
    const r = await prisma.$transaction(async (tx) => {
      await tx.descuentoTratamiento.deleteMany({ where: { descuentoId: id } });
      return tx.descuento.update({
        where: { id },
        data: { ...datos(d), tratamientos: { create: [...new Set(d.tratamientos)].map((tratamientoId) => ({ tratamientoId })) } },
        include: INCLUIR,
      });
    });
    return formatear(r);
  } catch (e) {
    throw duplicado(e);
  }
}
export async function cambiarEstado(id: number, activo: boolean) {
  await existe(id);
  return formatear(await prisma.descuento.update({ where: { id }, data: { activo }, include: INCLUIR }));
}
