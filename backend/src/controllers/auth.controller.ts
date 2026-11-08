import type { Request, Response } from 'express';
import { loginSchema, recuperarSchema, registroPacienteSchema, restablecerSchema, type RegistroPacienteDTO } from '@clinica/shared';
import * as AuthService from '../services/auth.service.js';
import { crearLimitador } from '../lib/limite.js';
import { ErrorNegocio } from '../lib/errores.js';
import * as PacienteService from '../services/paciente.service.js';

function iniciarSesion(req: Request, usuario: NonNullable<Request['session']['usuario']>) {
  // Regenerar el id de sesión al autenticarse (evita fijación de sesión)
  return new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.usuario = usuario;
      resolve();
    }),
  );
}

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const usuario = await AuthService.login(email, password, req.ip);
  await iniciarSesion(req, usuario);
  res.json(usuario);
}

export function logout(req: Request, res: Response) {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.status(204).end();
  });
}

export function yo(req: Request, res: Response) {
  res.json(req.session.usuario);
}

/** Límite por IP: 3 solicitudes cada 15 minutos (no revela si el correo existe). */
const recuperacionPorIp = crearLimitador(AuthService.LIMITE_RECUPERACION.max, AuthService.LIMITE_RECUPERACION.ventanaMs);

export async function recuperar(req: Request, res: Response) {
  if (!recuperacionPorIp.consumir(req.ip ?? 'desconocida')) {
    throw new ErrorNegocio(429, 'DEMASIADAS_SOLICITUDES', 'Demasiadas solicitudes de recuperación. Intente de nuevo en 15 minutos');
  }
  const { email } = recuperarSchema.parse(req.body);
  await AuthService.solicitarRecuperacion(email);
  res.json({ mensaje: 'Si el correo está registrado, le enviamos un enlace para restablecer su contraseña' });
}

export async function restablecer(req: Request, res: Response) {
  const { token, password } = restablecerSchema.parse(req.body);
  await AuthService.restablecerPassword(token, password);
  res.json({ mensaje: 'Contraseña actualizada; ya puede iniciar sesión' });
}

/** CU-03 (web): el paciente crea su cuenta y queda con la sesión iniciada. */
export async function registroPaciente(req: Request, res: Response) {
  const dto = registroPacienteSchema.parse(req.body) as RegistroPacienteDTO; // el esquema ya exige el correo
  const { usuario, paciente } = await PacienteService.registrarCuentaPaciente(dto);
  const sesion = { id: usuario.id, nombres: usuario.nombres, email: usuario.email, rol: usuario.rol, pacienteId: paciente.id, odontologoId: null };
  await iniciarSesion(req, sesion);
  res.status(201).json(sesion);
}
