import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ErrorNegocio } from '../lib/errores.js';

export function validar<T>(schema: { parse: (x: unknown) => T }, datos: unknown): T {
  return schema.parse(datos);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ErrorNegocio) {
    return res.status(err.status).json({ codigo: err.codigo, mensaje: err.message, campos: err.campos });
  }
  if (err instanceof ZodError) {
    const campos: Record<string, string> = {};
    for (const i of err.issues) campos[i.path.join('.')] ??= i.message;
    return res.status(422).json({ codigo: 'VALIDACION', mensaje: 'Revise los datos ingresados', campos });
  }
  // No registrar cuerpos de petición: pueden contener datos sensibles (RNF08)
  console.error('[error]', err instanceof Error ? err.message : err);
  res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' });
}
