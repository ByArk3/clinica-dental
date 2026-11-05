import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { MAX_INTENTOS_LOGIN, MENSAJES, MINUTOS_BLOQUEO_LOGIN, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { enviarCorreo } from '../lib/correo.js';
import { escaparHtml } from '../lib/html.js';
import { crearLimitador } from '../lib/limite.js';
import { registrar as registrarAuditoria } from './auditoria.service.js';

const RONDAS_BCRYPT = 10;
const MINUTOS_RECUPERACION = 30; // P16

export const hashPassword = (plano: string) => bcrypt.hash(plano, RONDAS_BCRYPT);
const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

const credencialesInvalidas = (restantes: number) =>
  new ErrorNegocio(
    401,
    'CREDENCIALES_INVALIDAS',
    `${MENSAJES.CREDENCIALES_INVALIDAS}. Le ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}`,
  );
const horaLima = (d: Date) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const cuentaBloqueada = (hasta: Date) =>
  new ErrorNegocio(423, 'CUENTA_BLOQUEADA', `${MENSAJES.CUENTA_BLOQUEADA}. Intente de nuevo a las ${horaLima(hasta)}`);

/**
 * CU-01 Iniciar sesión, con límite de intentos: al 3.er intento fallido seguido la cuenta queda
 * bloqueada 15 minutos (también para correos que no existen, para no revelar cuáles están registrados).
 * Mientras dura el bloqueo se rechaza incluso la contraseña correcta.
 */
export async function login(email: string, password: string, ip?: string): Promise<UsuarioSesion> {
  const correo = email.toLowerCase();
  const intento = await prisma.intentoLogin.findUnique({ where: { email: correo } });
  if (intento?.bloqueadoHasta && intento.bloqueadoHasta > new Date()) throw cuentaBloqueada(intento.bloqueadoHasta);

  const usuario = await prisma.usuario.findUnique({
    where: { email: correo },
    include: { paciente: true, odontologo: true },
  });
  // Mismo mensaje si no existe, está inactivo o la contraseña no coincide (no revelar cuentas)
  if (!usuario || !usuario.activo || !(await bcrypt.compare(password, usuario.password))) {
    await registrarFallo(correo, usuario?.id ?? null, ip);
  }
  await prisma.intentoLogin.deleteMany({ where: { email: correo } }); // ingresó: el contador vuelve a 0
  return {
    id: usuario!.id,
    nombres: usuario!.nombres,
    email: usuario!.email,
    rol: usuario!.rol,
    pacienteId: usuario!.paciente?.id ?? null,
    odontologoId: usuario!.odontologo?.id ?? null,
  };
}

/** Suma un intento fallido de forma atómica (dos intentos simultáneos no se pierden) y bloquea al llegar a 3. Siempre lanza. */
async function registrarFallo(email: string, usuarioId: number | null, ip?: string): Promise<never> {
  // Los timestamps (sin zona) se guardan en UTC: se compara con now() en UTC
  const [fila] = await prisma.$queryRaw<{ intentos: number; bloqueado_hasta: Date | null }[]>`
    INSERT INTO intentos_login (email, intentos, actualizado_en) VALUES (${email}, 1, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (email) DO UPDATE
      SET intentos = CASE
            WHEN intentos_login.bloqueado_hasta > (now() AT TIME ZONE 'UTC') THEN intentos_login.intentos -- ya bloqueada (intento simultáneo)
            WHEN intentos_login.bloqueado_hasta IS NOT NULL THEN 1 -- el bloqueo anterior venció: empieza de nuevo
            ELSE intentos_login.intentos + 1 END,
          bloqueado_hasta = CASE WHEN intentos_login.bloqueado_hasta > (now() AT TIME ZONE 'UTC') THEN intentos_login.bloqueado_hasta ELSE NULL END,
          actualizado_en = (now() AT TIME ZONE 'UTC')
    RETURNING intentos, bloqueado_hasta`;
  if (fila.bloqueado_hasta) throw cuentaBloqueada(new Date(`${fila.bloqueado_hasta.toISOString().slice(0, 23)}Z`));
  if (fila.intentos < MAX_INTENTOS_LOGIN) throw credencialesInvalidas(MAX_INTENTOS_LOGIN - fila.intentos);

  const hasta = new Date(Date.now() + MINUTOS_BLOQUEO_LOGIN * 60_000);
  await prisma.intentoLogin.update({ where: { email }, data: { intentos: 0, bloqueadoHasta: hasta } });
  await registrarAuditoria(prisma, {
    usuarioId,
    accion: 'bloqueo_login',
    detalle: `${MAX_INTENTOS_LOGIN} intentos fallidos con ${usuarioId ? 'la cuenta' : 'el correo (no registrado)'} ${email}`,
    ip,
  });
  throw cuentaBloqueada(hasta);
}

/** El Administrador desbloquea una cuenta antes de que pasen los 15 minutos. */
export async function desbloquear(usuarioId: number, admin: UsuarioSesion, ip?: string) {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!u) throw new ErrorNegocio(404, 'USUARIO_NO_ENCONTRADO', MENSAJES.USUARIO_NO_ENCONTRADO);
  const { count } = await prisma.intentoLogin.deleteMany({ where: { email: u.email } });
  if (count) await registrarAuditoria(prisma, { usuarioId: admin.id, accion: 'desbloqueo_login', detalle: `Desbloqueó la cuenta ${u.email}`, ip });
  return { bloqueadoHasta: null };
}

/** Correos con bloqueo vigente → hora de fin (para la lista de usuarios). */
export async function bloqueosVigentes(emails: string[]) {
  const filas = await prisma.intentoLogin.findMany({ where: { email: { in: emails }, bloqueadoHasta: { gt: new Date() } } });
  return new Map(filas.map((f) => [f.email, f.bloqueadoHasta!]));
}

/** Recuperar contraseña: como máximo 3 correos cada 15 minutos por cuenta (evita llenar su bandeja). */
export const LIMITE_RECUPERACION = { max: 3, ventanaMs: 15 * 60_000 };
const recuperacionPorCorreo = crearLimitador(LIMITE_RECUPERACION.max, LIMITE_RECUPERACION.ventanaMs);

/** CU-02 Recuperar contraseña: siempre responde igual, exista o no el correo (y aunque se supere el límite). */
export async function solicitarRecuperacion(email: string) {
  if (!recuperacionPorCorreo.consumir(email.toLowerCase())) return; // límite por correo: no se envía, sin avisar
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
    `<p>Hola ${escaparHtml(usuario.nombres)}:</p><p>Para crear una nueva contraseña ingrese a <a href="${enlace}">este enlace</a>. ` +
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
  await prisma.intentoLogin.deleteMany({ where: { email: usuario.email } }); // con la nueva contraseña ya puede ingresar
}
