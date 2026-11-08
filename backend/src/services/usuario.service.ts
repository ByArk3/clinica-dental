// Usuarios del personal (CU-34 a CU-37). Los pacientes crean su cuenta en la web (CU-03).
import { Prisma, type Rol } from '@prisma/client';
import { MENSAJES, type UsuarioModificarDTO, type UsuarioNuevoDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import bcrypt from 'bcryptjs';
import { bloqueosVigentes, hashPassword } from './auth.service.js';
import { registrar as auditar } from './auditoria.service.js';

const INCLUIR = { odontologo: true, paciente: { select: { id: true, dni: true } } } as const;
type UsuarioCompleto = Prisma.UsuarioGetPayload<{ include: typeof INCLUIR }>;
const formatear = (u: UsuarioCompleto, bloqueadoHasta: Date | null = null) => ({
  id: u.id,
  nombres: u.nombres,
  email: u.email,
  rol: u.rol,
  activo: u.activo,
  principal: u.principal, // RN-23
  cmp: u.odontologo?.cmp ?? null,
  especialidad: u.odontologo?.especialidad ?? null,
  dni: u.paciente?.dni ?? null,
  creado: u.createdAt.toISOString(),
  bloqueadoHasta: bloqueadoHasta?.toISOString() ?? null, // bloqueo por intentos fallidos
});
const prohibido = (mensaje: string) => new ErrorNegocio(403, 'NO_PERMITIDO', mensaje);
const ROL: Record<string, string> = { administrador: 'Administrador', recepcionista: 'Recepcionista', odontologo: 'Odontólogo', paciente: 'Paciente' };

/** RN-23: ¿quien actúa es el administrador principal? (se lee de la base, no de la sesión) */
async function esPrincipal(actual: UsuarioSesion) {
  return !!(await prisma.usuario.findUnique({ where: { id: actual.id }, select: { principal: true } }))?.principal;
}

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

/** CU-34 Registrar usuario del personal. Odontólogo → también su registro de odontólogo. Un administrador, solo el principal (RN-23). */
export async function crear(d: UsuarioNuevoDTO, actual: UsuarioSesion, ip?: string) {
  if (d.rol === 'administrador' && !(await esPrincipal(actual))) throw prohibido(MENSAJES.SOLO_PRINCIPAL_ADMINS);
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
    await auditar(prisma, { usuarioId: actual.id, accion: 'crear_usuario', detalle: `${u.nombres} (${u.email}) · ${ROL[u.rol]}`, ip });
    return formatear(u);
  } catch (e) {
    throw duplicado(e);
  }
}

/**
 * CU-36 Modificar. Reglas: el Administrador no puede quitarse su propio rol; el rol de odontólogo no se
 * asigna ni se quita a una cuenta existente (tiene citas y atenciones vinculadas); los pacientes no se editan aquí.
 */
export async function modificar(id: number, d: UsuarioModificarDTO, actual: UsuarioSesion, ip?: string) {
  const u = await prisma.usuario.findUnique({ where: { id }, include: INCLUIR });
  if (!u || u.rol === 'paciente') throw noEncontrado();
  // RN-23: el principal solo se modifica a sí mismo; a los demás administradores los gestiona solo el principal
  const otro = id !== actual.id;
  if (otro && u.principal) throw prohibido(MENSAJES.PRINCIPAL_PROTEGIDO);
  if (otro && (u.rol === 'administrador' || d.rol === 'administrador') && !(await esPrincipal(actual))) throw prohibido(MENSAJES.SOLO_PRINCIPAL_ADMINS);
  if (otro && u.rol === 'administrador' && d.password) throw prohibido(MENSAJES.NO_CONTRASENA_ADMIN);
  if (id === actual.id && d.rol !== 'administrador') throw new ErrorNegocio(422, 'NO_QUITARSE_ADMIN', MENSAJES.NO_QUITARSE_ADMIN, { rol: MENSAJES.NO_QUITARSE_ADMIN });
  if ((u.rol === 'odontologo') !== (d.rol === 'odontologo')) {
    throw new ErrorNegocio(422, 'CAMBIO_ROL_ODONTOLOGO', MENSAJES.CAMBIO_ROL_ODONTOLOGO, { rol: MENSAJES.CAMBIO_ROL_ODONTOLOGO });
  }
  if (u.rol === 'administrador' && d.rol !== 'administrador' && u.activo && (await prisma.usuario.count({ where: { rol: 'administrador', activo: true } })) <= 1) {
    throw new ErrorNegocio(422, 'ULTIMO_ADMIN', MENSAJES.ULTIMO_ADMIN, { rol: MENSAJES.ULTIMO_ADMIN });
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
    const cambios = [
      d.nombres !== u.nombres && `nombre «${u.nombres}» → «${d.nombres}»`,
      d.email.toLowerCase() !== u.email && `correo «${u.email}» → «${d.email.toLowerCase()}»`,
      d.rol !== u.rol && `rol ${ROL[u.rol]} → ${ROL[d.rol]}`,
      d.password && 'cambió la contraseña',
    ].filter(Boolean);
    if (cambios.length) await auditar(prisma, { usuarioId: actual.id, accion: 'modificar_usuario', detalle: `${actualizado.nombres}: ${cambios.join('; ')}`, ip });
    return formatear(actualizado);
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-37 Desactivar (borrado lógico; cierra sus sesiones) / reactivar. El Administrador no puede desactivarse. */
export async function cambiarEstado(id: number, activo: boolean, actual: UsuarioSesion, ip?: string) {
  const u = await prisma.usuario.findUnique({ where: { id }, include: INCLUIR });
  if (!u) throw noEncontrado();
  if (!activo && id === actual.id) throw new ErrorNegocio(422, 'NO_DESACTIVARSE', MENSAJES.NO_DESACTIVARSE);
  if (u.principal) throw prohibido(MENSAJES.PRINCIPAL_PROTEGIDO);
  if (u.rol === 'administrador' && !(await esPrincipal(actual))) throw prohibido(MENSAJES.SOLO_PRINCIPAL_ADMINS);
  if (!activo && u.rol === 'administrador' && (await prisma.usuario.count({ where: { rol: 'administrador', activo: true } })) <= 1) {
    throw new ErrorNegocio(422, 'ULTIMO_ADMIN', MENSAJES.ULTIMO_ADMIN);
  }
  const r = await prisma.usuario.update({
    where: { id },
    data: { activo, ...(u.odontologo ? { odontologo: { update: { activo } } } : {}) },
    include: INCLUIR,
  });
  if (!activo) await cerrarSesiones(id);
  await auditar(prisma, { usuarioId: actual.id, accion: activo ? 'activar_usuario' : 'desactivar_usuario', detalle: `${r.nombres} (${r.email}) · ${ROL[r.rol]}`, ip });
  return formatear(r);
}

/**
 * CU-59 Traspasar el papel de administrador principal (RN-23): solo el principal, a otro administrador activo,
 * confirmando con su propia contraseña. Queda en la auditoría.
 */
export async function traspasarPrincipal(destinoId: number, password: string, actual: UsuarioSesion, ip?: string) {
  const yo = await prisma.usuario.findUniqueOrThrow({ where: { id: actual.id } });
  if (!yo.principal) throw prohibido(MENSAJES.SOLO_PRINCIPAL_TRASPASA);
  if (!(await bcrypt.compare(password, yo.password))) throw new ErrorNegocio(422, 'CONTRASENA_INCORRECTA', MENSAJES.CONTRASENA_INCORRECTA, { password: MENSAJES.CONTRASENA_INCORRECTA });
  const destino = await prisma.usuario.findUnique({ where: { id: destinoId } });
  if (!destino || destino.id === yo.id || destino.rol !== 'administrador' || !destino.activo) throw new ErrorNegocio(422, 'TRASPASO_DESTINO', MENSAJES.TRASPASO_DESTINO);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: yo.id }, data: { principal: false } });
    await tx.usuario.update({ where: { id: destino.id }, data: { principal: true } });
    await auditar(tx, { usuarioId: yo.id, accion: 'traspasar_principal', detalle: `${yo.nombres} → ${destino.nombres} (${destino.email})`, ip });
  });
  return formatear(await prisma.usuario.findUniqueOrThrow({ where: { id: destino.id }, include: INCLUIR }));
}
