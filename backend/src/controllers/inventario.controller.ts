import type { Request, Response } from 'express';
import { insumoNuevoSchema, insumoSchema, tratamientoSchema } from '@clinica/shared';
import * as TratamientoService from '../services/tratamiento.service.js';
import * as InsumoService from '../services/insumo.service.js';
import { usuarioActual } from '../middlewares/auth.js';
import { boolQuery, idParam, textoQuery } from './comun.js';

// ---------- Tarifario ----------
/** CU-15. El odontólogo solo ve los tratamientos activos (para registrar la atención). */
export async function listarTratamientos(req: Request, res: Response) {
  const activo = usuarioActual(req).rol === 'odontologo' ? true : boolQuery(req.query.activo);
  res.json(await TratamientoService.listar({ q: textoQuery(req.query.q), activo }));
}
export async function crearTratamiento(req: Request, res: Response) {
  res.status(201).json(await TratamientoService.crear(tratamientoSchema.parse(req.body)));
}
export async function modificarTratamiento(req: Request, res: Response) {
  res.json(await TratamientoService.modificar(idParam(req), tratamientoSchema.parse(req.body)));
}
export const desactivarTratamiento = async (req: Request, res: Response) =>
  res.json(await TratamientoService.cambiarEstado(idParam(req), false));
export const activarTratamiento = async (req: Request, res: Response) =>
  res.json(await TratamientoService.cambiarEstado(idParam(req), true));

// ---------- Insumos ----------
export async function listarInsumos(req: Request, res: Response) {
  res.json(
    await InsumoService.listar({ q: textoQuery(req.query.q), activo: boolQuery(req.query.activo), bajoMinimo: boolQuery(req.query.bajoMinimo) }),
  );
}
/** CU-22 Buscar insumo: solo activos */
export async function buscarInsumo(req: Request, res: Response) {
  res.json(await InsumoService.listar({ q: textoQuery(req.query.q), activo: true }));
}
export async function crearInsumo(req: Request, res: Response) {
  res.status(201).json(await InsumoService.crear(insumoNuevoSchema.parse(req.body), usuarioActual(req).id));
}
export async function modificarInsumo(req: Request, res: Response) {
  // insumoSchema no tiene stock: aunque lo envíen, se ignora (Zod descarta claves desconocidas)
  res.json(await InsumoService.modificar(idParam(req), insumoSchema.parse(req.body)));
}
export const desactivarInsumo = async (req: Request, res: Response) => res.json(await InsumoService.cambiarEstado(idParam(req), false));
export const activarInsumo = async (req: Request, res: Response) => res.json(await InsumoService.cambiarEstado(idParam(req), true));
export const kardex = async (req: Request, res: Response) => res.json(await InsumoService.kardex(idParam(req)));
export const alertas = async (_req: Request, res: Response) => res.json(await InsumoService.alertasPendientes());
