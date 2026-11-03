import type { Request, Response } from 'express';
import { dniSchema, pacienteSchema } from '@clinica/shared';
import * as PacienteService from '../services/paciente.service.js';

/** CU-03 Registrar paciente (recepcionista) — flujo alterno 4.1 de CU-06 */
export async function registrar(req: Request, res: Response) {
  const dto = pacienteSchema.parse(req.body);
  res.status(201).json(await PacienteService.registrarPaciente(dto));
}

/** GET /pacientes?dni= (c_buscarPaciente) */
export async function buscarPorDni(req: Request, res: Response) {
  const dni = dniSchema.parse(req.query.dni);
  res.json(await PacienteService.buscarPorDni(dni));
}
