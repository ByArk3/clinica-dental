// Proveedores (CU-26 a CU-29). Desactivar = borrado lógico.
import { Prisma } from '@prisma/client';
import { MENSAJES, type ProveedorDTO } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';

type Proveedor = Prisma.ProveedorGetPayload<object>;
const formatear = (p: Proveedor) => ({
  id: p.id,
  ruc: p.ruc,
  razonSocial: p.razonSocial,
  contacto: p.contacto,
  telefono: p.telefono,
  email: p.email,
  activo: p.activo,
});
const noEncontrado = () => new ErrorNegocio(404, 'PROVEEDOR_NO_ENCONTRADO', MENSAJES.PROVEEDOR_NO_ENCONTRADO);
const duplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ErrorNegocio(409, 'RUC_DUPLICADO', MENSAJES.RUC_DUPLICADO, { ruc: MENSAJES.RUC_DUPLICADO })
    : e;
const datos = (d: ProveedorDTO) => ({
  ruc: d.ruc,
  razonSocial: d.razonSocial,
  contacto: d.contacto ?? null,
  telefono: d.telefono ?? null,
  email: d.email?.toLowerCase() ?? null,
});

/** CU-27 Listar (búsqueda por RUC o razón social; filtro por estado). */
export async function listar(f: { q?: string; activo?: boolean }) {
  const lista = await prisma.proveedor.findMany({
    where: {
      ...(f.activo !== undefined ? { activo: f.activo } : {}),
      ...(f.q ? { OR: [{ razonSocial: { contains: f.q, mode: 'insensitive' } }, { ruc: { startsWith: f.q } }] } : {}),
    },
    orderBy: { razonSocial: 'asc' },
  });
  return lista.map(formatear);
}

/** CU-26 Registrar */
export async function crear(d: ProveedorDTO) {
  try {
    return formatear(await prisma.proveedor.create({ data: datos(d) }));
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-28 Modificar */
export async function modificar(id: number, d: ProveedorDTO) {
  if (!(await prisma.proveedor.findUnique({ where: { id } }))) throw noEncontrado();
  try {
    return formatear(await prisma.proveedor.update({ where: { id }, data: datos(d) }));
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-29 Desactivar (no si tiene pedidos pendientes) / reactivar */
export async function cambiarEstado(id: number, activo: boolean) {
  if (!(await prisma.proveedor.findUnique({ where: { id } }))) throw noEncontrado();
  if (!activo && (await prisma.pedido.count({ where: { proveedorId: id, estado: 'pendiente' } })) > 0) {
    throw new ErrorNegocio(409, 'PROVEEDOR_CON_PEDIDOS', MENSAJES.PROVEEDOR_CON_PEDIDOS);
  }
  return formatear(await prisma.proveedor.update({ where: { id }, data: { activo } }));
}
