import type { Request, Response } from 'express';
import { z } from 'zod';
import { atencionSchema, editarAtencionSchema, fechaSchema } from '@clinica/shared';
import * as HistorialService from '../services/historial.service.js';
import * as AtencionService from '../services/atencion.service.js';
import { usuarioActual } from '../middlewares/auth.js';
import { idParam } from './comun.js';
import { ahoraLima } from '../lib/fechas.js';
import { prisma } from '../lib/prisma.js';
import { registrar as registrarAuditoria } from '../services/auditoria.service.js';

/** CU-10: GET /pacientes/buscar?q= (c_buscarPaciente) */
export async function buscarPacientes(req: Request, res: Response) {
  const q = z.string({ required_error: 'Ingrese DNI o nombre' }).trim().min(2, 'Ingrese al menos 2 caracteres').max(100).parse(req.query.q);
  res.json(await HistorialService.buscarPacientes(q));
}

/** CU-10: GET /pacientes/:id/historial (c_consultarHistorial) */
export async function historial(req: Request, res: Response) {
  const h = await HistorialService.historial(idParam(req));
  // Auditoría: queda registrado quién abrió la ficha de este paciente y cuándo
  await registrarAuditoria(prisma, { usuarioId: usuarioActual(req).id, accion: 'ver_historial', pacienteId: h.paciente.id, ip: req.ip });
  res.json(h);
}

/** CU-11 paso 1: GET /odontologos/me/citas?fecha= (por defecto hoy) */
export async function misCitas(req: Request, res: Response) {
  const fecha = req.query.fecha ? fechaSchema.parse(req.query.fecha) : ahoraLima().fecha;
  res.json(await AtencionService.citasDelOdontologo(usuarioActual(req).odontologoId!, fecha));
}

/** CU-11: POST /citas/:id/atencion (c_registrarAtencion) */
export async function registrar(req: Request, res: Response) {
  res.status(201).json(await AtencionService.registrarAtencion(idParam(req), usuarioActual(req), atencionSchema.parse(req.body)));
}

/** GET /atenciones/:id — datos para editar (solo su odontólogo) */
export async function verParaEditar(req: Request, res: Response) {
  res.json(await AtencionService.verParaEditar(idParam(req), usuarioActual(req)));
}

/** PATCH /atenciones/:id — corregir la atención, con motivo; se guarda la versión anterior */
export async function editar(req: Request, res: Response) {
  res.json(await AtencionService.editarAtencion(idParam(req), usuarioActual(req), editarAtencionSchema.parse(req.body), req.ip));
}
