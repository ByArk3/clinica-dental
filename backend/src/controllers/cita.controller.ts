import type { Request, Response } from 'express';
import { citaSchema, disponibilidadQuerySchema } from '@clinica/shared';
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
