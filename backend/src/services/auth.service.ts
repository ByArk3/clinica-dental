import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { MENSAJES, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { enviarCorreo } from '../lib/correo.js';

const RONDAS_BCRYPT = 10;
const MINUTOS_RECUPERACION = 30; // P16

export const hashPassword = (plano: string) => bcrypt.hash(plano, RONDAS_BCRYPT);
const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** CU-01 Iniciar sesión */
export async function login(email: string, password: string): Promise<UsuarioSesion> {
  const usuario = await prisma.usuario.findUnique({
    where: { email: email.toLowerCase() },
    include: { paciente: true, odontologo: true },
  });
  // Mismo mensaje si no existe, está inactivo o la contraseña no coincide (no revelar cuentas)
  if (!usuario || !usuario.activo || !(await bcrypt.compare(password, usuario.password))) {
    throw new ErrorNegocio(401, 'CREDENCIALES_INVALIDAS', MENSAJES.CREDENCIALES_INVALIDAS);
  }
  return {
    id: usuario.id,
    nombres: usuario.nombres,
    email: usuario.email,
    rol: usuario.rol,
    pacienteId: usuario.paciente?.id ?? null,
    odontologoId: usuario.odontologo?.id ?? null,
  };
}

/** CU-02 Recuperar contraseña: siempre responde igual, exista o no el correo. */
export async function solicitarRecuperacion(email: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email: email.toLowerCase() } });
  if (!usuario || !usuario.activo) return;
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      resetTokenHash: sha256(token),
      resetTokenExpira: new Date(Date.now() + MINUTOS_RECUPERACION * 60_000),
    },
  });
  const enlace = `${process.env.FRONTEND_URL}/restablecer?token=${token}`;
  await enviarCorreo(
    usuario.email,
    'Recuperar contraseña — Clínica Dental',
    `<p>Hola ${usuario.nombres}:</p><p>Para crear una nueva contraseña ingrese a <a href="${enlace}">este enlace</a>. ` +
      `Es válido por ${MINUTOS_RECUPERACION} minutos.</p><p>Si usted no lo solicitó, ignore este mensaje.</p>`,
  );
  return token; // solo lo usan las pruebas; el controlador no lo devuelve
}

export async function restablecerPassword(token: string, password: string) {
  const usuario = await prisma.usuario.findUnique({ where: { resetTokenHash: sha256(token) } });
  if (!usuario || !usuario.resetTokenExpira || usuario.resetTokenExpira < new Date()) {
    throw new ErrorNegocio(422, 'ENLACE_INVALIDO', MENSAJES.ENLACE_INVALIDO);
  }
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { password: await hashPassword(password), resetTokenHash: null, resetTokenExpira: null },
  });
}
