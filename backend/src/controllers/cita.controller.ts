import type { Request, Response } from 'express';
import { z } from 'zod';
import { editarCitaSchema, cancelarCitaSchema, reportarPagoSchema, citaSchema, confirmacionSchema, disponibilidadQuerySchema, fechaSchema, reprogramarSchema } from '@clinica/shared';
import * as ConfirmacionService from '../services/confirmacion.service.js';
import { prisma } from '../lib/prisma.js';
import * as CitaService from '../services/cita.service.js';
import * as DisponibilidadService from '../services/disponibilidad.service.js';
import * as OdontologoService from '../services/odontologo.service.js';
import * as PagoService from '../services/pago.service.js';
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
  res.json(await CitaService.cancelarCita(idParam(req), usuarioActual(req), cancelarCitaSchema.parse(req.body ?? {})));
}

/** El paciente reporta el pago del adelanto (Yape/Plin) */
export async function reportarPago(req: Request, res: Response) {
  res.json(await CitaService.reportarPago(idParam(req), usuarioActual(req), reportarPagoSchema.parse(req.body)));
}

/** Datos de Yape/Plin de la clínica para pagar el adelanto */
export const datosPago = async (_req: Request, res: Response) => res.json(await PagoService.datosPago());

/** Tarifario activo (nombre y precio) para elegir el tratamiento previsto al reservar */
export async function tarifarioPublico(_req: Request, res: Response) {
  const lista = await prisma.tratamiento.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, precio: true } });
  res.json(lista.map((t) => ({ id: t.id, nombre: t.nombre, precio: t.precio.toFixed(2) })));
}

/** CU-09: GET /citas?fecha= */
export async function delDia(req: Request, res: Response) {
  const fecha = fechaSchema.parse(req.query.fecha);
  res.json(await CitaService.citasDelDia(fecha));
}
export async function inasistencia(req: Request, res: Response) {
  res.json(await CitaService.registrarInasistencia(idParam(req)));
}

/** CU-08 Recordar cita: enlace público con token (cancelar, o confirmar en citas antiguas) */
export async function verConfirmacion(req: Request, res: Response) {
  res.json(await ConfirmacionService.obtenerPorToken(String(req.params.token)));
}
export async function responderConfirmacion(req: Request, res: Response) {
  const { accion } = confirmacionSchema.parse(req.body);
  res.json(await ConfirmacionService.responder(String(req.params.token), accion));
}

/** GET /datos-pago/qr — imagen del QR de pago de la clínica */
export async function qrPago(_req: Request, res: Response) {
  const q = await PagoService.qr();
  res.setHeader('Content-Type', q.tipo);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.send(q.datos);
}

/** PATCH /citas/:id/datos — editar motivo y (sin adelanto pagado) tratamiento previsto */
export async function editarDatos(req: Request, res: Response) {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  res.json(await CitaService.editarDatosCita(id, editarCitaSchema.parse(req.body), usuarioActual(req).id, req.ip));
}
