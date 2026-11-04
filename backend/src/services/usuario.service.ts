// Usuarios del personal (CU-34 a CU-37). Los pacientes crean su cuenta en la web (CU-03).
import { Prisma, type Rol } from '@prisma/client';
import { MENSAJES, type UsuarioModificarDTO, type UsuarioNuevoDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { bloqueosVigentes, hashPassword } from './auth.service.js';

const INCLUIR = { odontologo: true, paciente: { select: { id: true, dni: true } } } as const;
type UsuarioCompleto = Prisma.UsuarioGetPayload<{ include: typeof INCLUIR }>;
const formatear = (u: UsuarioCompleto, bloqueadoHasta: Date | null = null) => ({
  id: u.id,
  nombres: u.nombres,
  email: u.email,
  rol: u.rol,
  activo: u.activo,
  cmp: u.odontologo?.cmp ?? null,
  especialidad: u.odontologo?.especialidad ?? null,
  dni: u.paciente?.dni ?? null,
  creado: u.createdAt.toISOString(),
  bloqueadoHasta: bloqueadoHasta?.toISOString() ?? null, // bloqueo por intentos fallidos
});
const noEncontrado = () => new ErrorNegocio(404, 'USUARIO_NO_ENCONTRADO', MENSAJES.USUARIO_NO_ENCONTRADO);
const duplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ErrorNegocio(409, 'EMAIL_DUPLICADO', MENSAJES.EMAIL_DUPLICADO, { email: MENSAJES.EMAIL_DUPLICADO })
    : e;

/** Cierra las sesiones abiertas de un usuario (al desactivarlo o cambiarle rol o contraseña). */
async function cerrarSesiones(usuarioId: number) {
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ${usuarioId}`;
}

/** CU-35 Listar usuarios (búsqueda, rol y estado). */
export async function listar(f: { q?: string; rol?: Rol; activo?: boolean }) {
  const lista = await prisma.usuario.findMany({
    where: {
      ...(f.rol ? { rol: f.rol } : {}),
      ...(f.activo !== undefined ? { activo: f.activo } : {}),
      ...(f.q ? { OR: [{ nombres: { contains: f.q, mode: 'insensitive' } }, { email: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ rol: 'asc' }, { nombres: 'asc' }],
    include: INCLUIR,
  });
  const bloqueos = await bloqueosVigentes(lista.map((u) => u.email));
  return lista.map((u) => formatear(u, bloqueos.get(u.email) ?? null));
}

/** CU-34 Registrar usuario del personal. Odontólogo → también su registro de odontólogo. */
export async function crear(d: UsuarioNuevoDTO) {
  const password = await hashPassword(d.password);
  try {
    const u = await prisma.usuario.create({
      data: {
        nombres: d.nombres,
        email: d.email.toLowerCase(),
        password,
        rol: d.rol,
        ...(d.rol === 'odontologo' ? { odontologo: { create: { cmp: d.cmp ?? null, especialidad: d.especialidad ?? null } } } : {}),
      },
      include: INCLUIR,
    });
    return formatear(u);
  } catch (e) {
    throw duplicado(e);
  }
}

/**
 * CU-36 Modificar. Reglas: el Administrador no puede quitarse su propio rol; el rol de odontólogo no se
 * asigna ni se quita a una cuenta existente (tiene citas y atenciones vinculadas); los pacientes no se editan aquí.
 */
export async function modificar(id: number, d: UsuarioModificarDTO, actual: UsuarioSesion) {
  const u = await prisma.usuario.findUnique({ where: { id }, include: INCLUIR });
  if (!u || u.rol === 'paciente') throw noEncontrado();
  if (id === actual.id && d.rol !== 'administrador') throw new ErrorNegocio(422, 'NO_QUITARSE_ADMIN', MENSAJES.NO_QUITARSE_ADMIN, { rol: MENSAJES.NO_QUITARSE_ADMIN });
  if ((u.rol === 'odontologo') !== (d.rol === 'odontologo')) {
    throw new ErrorNegocio(422, 'CAMBIO_ROL_ODONTOLOGO', MENSAJES.CAMBIO_ROL_ODONTOLOGO, { rol: MENSAJES.CAMBIO_ROL_ODONTOLOGO });
  }
  try {
    const actualizado = await prisma.usuario.update({
      where: { id },
      data: {
        nombres: d.nombres,
        email: d.email.toLowerCase(),
        rol: d.rol,
        ...(d.password ? { password: await hashPassword(d.password) } : {}),
        ...(u.odontologo ? { odontologo: { update: { cmp: d.cmp ?? null, especialidad: d.especialidad ?? null } } } : {}),
      },
      include: INCLUIR,
    });
    if (d.password || d.rol !== u.rol || d.email.toLowerCase() !== u.email) await cerrarSesiones(id);
    return formatear(actualizado);
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-37 Desactivar (borrado lógico; cierra sus sesiones) / reactivar. El Administrador no puede desactivarse. */
export async function cambiarEstado(id: number, activo: boolean, actual: UsuarioSesion) {
  const u = await prisma.usuario.findUnique({ where: { id }, include: INCLUIR });
  if (!u) throw noEncontrado();
  if (!activo && id === actual.id) throw new ErrorNegocio(422, 'NO_DESACTIVARSE', MENSAJES.NO_DESACTIVARSE);
  const r = await prisma.usuario.update({
    where: { id },
    data: { activo, ...(u.odontologo ? { odontologo: { update: { activo } } } : {}) },
    include: INCLUIR,
  });
  if (!activo) await cerrarSesiones(id);
  return formatear(r);
}
