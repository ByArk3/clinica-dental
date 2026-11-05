import type { Request, Response } from 'express';
import { z } from 'zod';
import { contactoSchema, dniSchema, pacienteSchema } from '@clinica/shared';
import { usuarioActual } from '../middlewares/auth.js';
import * as ReniecService from '../services/reniec.service.js';
import { vencimientos } from '../services/saldo.service.js';
import { prisma } from '../lib/prisma.js';
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

const idParam = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);

/** CU-04 (recepcionista): PATCH /pacientes/:id/contacto */
export async function actualizarContacto(req: Request, res: Response) {
  res.json(await PacienteService.actualizarContacto(idParam(req), contactoSchema.parse(req.body)));
}

/** CU-04 (paciente): GET/PATCH /pacientes/me */
export async function miPerfil(req: Request, res: Response) {
  const id = usuarioActual(req).pacienteId!;
  // con los próximos vencimientos del saldo a favor
  res.json({ ...(await PacienteService.obtenerContacto(id)), saldoVencimientos: await vencimientos(prisma, id) });
}
export async function actualizarMiContacto(req: Request, res: Response) {
  res.json(await PacienteService.actualizarContacto(usuarioActual(req).pacienteId!, contactoSchema.parse(req.body)));
}

/** GET /reniec/:dni — nombres y apellidos para autocompletar el registro presencial (si hay proveedor configurado) */
export async function reniec(req: Request, res: Response) {
  res.json(await ReniecService.consultarDni(dniSchema.parse(req.params.dni)));
}
