import type { Request, Response } from 'express';
import { comprobanteSchema, fechaSchema, MENSAJES, motivoSchema, rechazarPagoSchema } from '@clinica/shared';
import { ahoraLima } from '../lib/fechas.js';
import * as CajaService from '../services/caja.service.js';
import { prisma } from '../lib/prisma.js';
import { pdfComprobante } from '../lib/pdf.js';
import { enviarCorreo } from '../lib/correo.js';
import { ErrorNegocio } from '../lib/errores.js';
import { usuarioActual } from '../middlewares/auth.js';
import { idParam } from './comun.js';

export const pendientes = async (_req: Request, res: Response) => res.json(await CajaService.pendientes());
export const tiposPago = async (_req: Request, res: Response) => res.json(await CajaService.tiposPago());
/** Campañas vigentes hoy (se aplican solas en el importe) */
export const campanas = async (_req: Request, res: Response) => res.json(await CajaService.campanasDeHoy());

/** GET /caja/citas/:id/importe (c_calcularImporte) */
export async function importe(req: Request, res: Response) {
  res.json(await CajaService.calcularImporte(prisma, idParam(req)));
}

/** Pago de adelanto reportado por el paciente (Yape/Plin) */
export const aprobarPago = async (req: Request, res: Response) => res.status(201).json(await CajaService.aprobarPago(idParam(req), usuarioActual(req)));
export const rechazarPago = async (req: Request, res: Response) =>
  res.json(await CajaService.rechazarPago(idParam(req), rechazarPagoSchema.parse(req.body).motivo));
export async function captura(req: Request, res: Response) {
  const c = await CajaService.capturaPago(idParam(req));
  res.setHeader('Content-Type', c.tipo);
  res.setHeader('Cache-Control', 'no-store');
  res.send(c.datos);
}

/** POST /caja/citas/:id/comprobante (c_emitirComprobante) */
export async function emitir(req: Request, res: Response) {
  res.status(201).json(await CajaService.emitirComprobante(idParam(req), comprobanteSchema.parse(req.body), usuarioActual(req)));
}

export const ver = async (req: Request, res: Response) => res.json(await CajaService.obtenerComprobante(idParam(req)));

/** GET /comprobantes/:id/pdf — 10.1: si falla, el comprobante ya está registrado y se puede reintentar */
export async function pdf(req: Request, res: Response) {
  const c = await CajaService.buscarComprobante(idParam(req));
  let archivo: Buffer;
  try {
    archivo = await pdfComprobante(c);
  } catch {
    throw new ErrorNegocio(500, 'ERROR_PDF', MENSAJES.ERROR_PDF);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${c.numero}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(archivo);
}

/** POST /comprobantes/:id/enviar — 9.1: sin correo no se puede enviar */
export async function enviar(req: Request, res: Response) {
  const c = await CajaService.buscarComprobante(idParam(req));
  if (c.anuladoEn) throw new ErrorNegocio(409, 'COMPROBANTE_YA_ANULADO', MENSAJES.COMPROBANTE_YA_ANULADO);
  if (!c.paciente.email) throw new ErrorNegocio(422, 'PACIENTE_SIN_CORREO', MENSAJES.PACIENTE_SIN_CORREO);
  try {
    const archivo = await pdfComprobante(c);
    await enviarCorreo(
      c.paciente.email,
      `Comprobante ${c.numero} — Clínica Dental`,
      `<p>Hola ${c.paciente.nombres}:</p><p>Adjuntamos su comprobante <b>${c.numero}</b> por <b>S/ ${c.total.toFixed(2)}</b>.</p><p>Gracias por su preferencia.</p>`,
      [{ filename: `${c.numero}.pdf`, content: archivo, contentType: 'application/pdf' }],
    );
  } catch {
    throw new ErrorNegocio(502, 'ERROR_CORREO', MENSAJES.ERROR_CORREO);
  }
  await CajaService.marcarEnviado(c.id);
  res.json({ mensaje: `Comprobante enviado a ${c.paciente.email}` });
}

/** GET /caja/comprobantes?fecha= (por defecto hoy) */
export async function delDia(req: Request, res: Response) {
  const fecha = req.query.fecha ? fechaSchema.parse(req.query.fecha) : ahoraLima().fecha;
  res.json(await CajaService.comprobantesDelDia(fecha, usuarioActual(req)));
}

/** PATCH /comprobantes/:id/anular — recepcionista (solo los de hoy) o administrador, con motivo */
export async function anular(req: Request, res: Response) {
  const { motivo } = motivoSchema.parse(req.body);
  res.json(await CajaService.anularComprobante(idParam(req), motivo, usuarioActual(req), req.ip));
}
