// Descuentos (P3): los gestiona el Administrador; la recepcionista elige uno activo por cobro.
import { Prisma } from '@prisma/client';
import { MENSAJES, type DescuentoDTO } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';

const formatear = (d: Prisma.DescuentoGetPayload<object>) => ({ id: d.id, nombre: d.nombre, porcentaje: d.porcentaje.toFixed(2), activo: d.activo });
const duplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ErrorNegocio(409, 'DESCUENTO_DUPLICADO', 'Ya existe un descuento con ese nombre', { nombre: 'Ya existe un descuento con ese nombre' })
    : e;
const existe = async (id: number) => {
  if (!(await prisma.descuento.findUnique({ where: { id } }))) throw new ErrorNegocio(404, 'DESCUENTO_NO_VALIDO', MENSAJES.DESCUENTO_NO_VALIDO);
};

export const listar = async () => (await prisma.descuento.findMany({ orderBy: { nombre: 'asc' } })).map(formatear);
export async function crear(d: DescuentoDTO) {
  try {
    return formatear(await prisma.descuento.create({ data: d }));
  } catch (e) {
    throw duplicado(e);
  }
}
export async function modificar(id: number, d: DescuentoDTO) {
  await existe(id);
  try {
    return formatear(await prisma.descuento.update({ where: { id }, data: d }));
  } catch (e) {
    throw duplicado(e);
  }
}
export async function cambiarEstado(id: number, activo: boolean) {
  await existe(id);
  return formatear(await prisma.descuento.update({ where: { id }, data: { activo } }));
}

/** P6: monto del adelanto configurable */
export async function montoAdelanto() {
  return (await prisma.configuracion.findUnique({ where: { clave: 'monto_adelanto' } }))?.valor ?? '30.00';
}
export async function cambiarMontoAdelanto(monto: number) {
  const valor = monto.toFixed(2);
  await prisma.configuracion.upsert({ where: { clave: 'monto_adelanto' }, update: { valor }, create: { clave: 'monto_adelanto', valor } });
  return valor;
}
