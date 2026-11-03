import type { Request, Response } from 'express';
import { z } from 'zod';
import { citaSchema, confirmacionSchema, disponibilidadQuerySchema, fechaSchema, reprogramarSchema } from '@clinica/shared';
import * as ConfirmacionService from '../services/confirmacion.service.js';
import * as CitaService from '../services/cita.service.js';
import * as DisponibilidadService from '../services/disponibilidad.service.js';
import * as OdontologoService from '../services/odontologo.service.js';
import { usuarioActual } from '../middlewares/auth.js';

/** CU-05 (c_consultarDisponibilidad) */
export async function disponibilidad(req: Request, res: Response) {
  const { odontologoId, fecha } = disponibilidadQuerySchema.parse(req.query);
  res.json(await DisponibilidadService.consultarDisponibilidad(odontologoId, fecha));
}

/** CU-06 (c_grabarCita) */
export async function registrar(req: Request, res: Response) {
  const dto = citaSchema.parse(req.body);
  res.status(201).json(await CitaService.registrarCita(dto, usuarioActual(req)));
}

export async function mias(req: Request, res: Response) {
  res.json(await CitaService.citasDelPaciente(usuarioActual(req).pacienteId!));
}

export async function odontologos(_req: Request, res: Response) {
  res.json(await OdontologoService.listarOdontologosActivos());
}

const idParam = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);

/** CU-07 */
export async function reprogramar(req: Request, res: Response) {
  res.json(await CitaService.reprogramarCita(idParam(req), reprogramarSchema.parse(req.body), usuarioActual(req)));
}
export async function cancelar(req: Request, res: Response) {
  res.json(await CitaService.cancelarCita(idParam(req), usuarioActual(req)));
}

/** CU-09: GET /citas?fecha= */
export async function delDia(req: Request, res: Response) {
  const fecha = fechaSchema.parse(req.query.fecha);
  res.json(await CitaService.citasDelDia(fecha));
}
export async function inasistencia(req: Request, res: Response) {
  res.json(await CitaService.registrarInasistencia(idParam(req)));
}

/** CU-08: enlace público con token */
export async function verConfirmacion(req: Request, res: Response) {
  res.json(await ConfirmacionService.obtenerPorToken(String(req.params.token)));
}
export async function responderConfirmacion(req: Request, res: Response) {
  const { accion } = confirmacionSchema.parse(req.body);
  res.json(await ConfirmacionService.responder(String(req.params.token), accion));
}
