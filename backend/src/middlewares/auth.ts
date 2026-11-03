import type { Request, Response, NextFunction } from 'express';
import type { Rol, UsuarioSesion } from '@clinica/shared';
import { MENSAJES } from '@clinica/shared';
import { ErrorNegocio } from '../lib/errores.js';

declare module 'express-session' {
  interface SessionData {
    usuario?: UsuarioSesion;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.usuario) return next(new ErrorNegocio(401, 'NO_AUTENTICADO', MENSAJES.NO_AUTENTICADO));
  next();
}

/** RNF07: control de acceso por rol en la API (la API es la que manda). */
export const requireRol = (...roles: Rol[]) => requireRolConMensaje(MENSAJES.SIN_PERMISO, ...roles);

/** Igual que requireRol, con un mensaje propio (p. ej. CU-10 4.1 «No tiene permiso para ver el historial clínico»). */
export const requireRolConMensaje =
  (mensaje: string, ...roles: Rol[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const u = req.session.usuario;
    if (!u) return next(new ErrorNegocio(401, 'NO_AUTENTICADO', MENSAJES.NO_AUTENTICADO));
    if (!roles.includes(u.rol)) return next(new ErrorNegocio(403, 'SIN_PERMISO', mensaje));
    next();
  };

export const usuarioActual = (req: Request) => req.session.usuario!;
