// Iteración 4: proveedores, pedidos, ajustes/alertas, usuarios, descuentos, panel y reportes (Administrador).
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  ACCIONES_AUDITORIA,
  ajusteSchema,
  configPagoSchema,
  qrPagoSchema,
  feriadoSchema,
  horarioSchema,
  anularPedidoSchema,
  descuentoSchema,
  ESTADOS_PEDIDO,
  fechaSchema,
  MENSAJES,
  pedidoSchema,
  proveedorSchema,
  rangoFechasSchema,
  hastaHoySchema,
  recepcionSchema,
  ROLES,
  usuarioModificarSchema,
  traspasoPrincipalSchema,
  usuarioNuevoSchema,
} from '@clinica/shared';
import * as ProveedorService from '../services/proveedor.service.js';
import * as PedidoService from '../services/pedido.service.js';
import * as InsumoService from '../services/insumo.service.js';
import * as UsuarioService from '../services/usuario.service.js';
import * as DescuentoService from '../services/descuento.service.js';
import * as ReporteService from '../services/reporte.service.js';
import * as AgendaService from '../services/agenda.service.js';
import * as AuthService from '../services/auth.service.js';
import * as AuditoriaService from '../services/auditoria.service.js';
import * as PagoService from '../services/pago.service.js';
import * as ReniecService from '../services/reniec.service.js';
import { pdfPedido } from '../lib/pdf-pedido.js';
import { enviarCorreo } from '../lib/correo.js';
import { ErrorNegocio } from '../lib/errores.js';
import { usuarioActual } from '../middlewares/auth.js';
import { boolQuery, idParam, textoQuery } from './comun.js';
import { escaparHtml } from '../lib/html.js';
import { ahoraLima } from '../lib/fechas.js';

// ---------- Proveedores CU-26..29 ----------
export const listarProveedores = async (req: Request, res: Response) =>
  res.json(await ProveedorService.listar({ q: textoQuery(req.query.q), activo: boolQuery(req.query.activo) }));
export const crearProveedor = async (req: Request, res: Response) => res.status(201).json(await ProveedorService.crear(proveedorSchema.parse(req.body)));
export const modificarProveedor = async (req: Request, res: Response) => res.json(await ProveedorService.modificar(idParam(req), proveedorSchema.parse(req.body)));
export const desactivarProveedor = async (req: Request, res: Response) => res.json(await ProveedorService.cambiarEstado(idParam(req), false));
export const activarProveedor = async (req: Request, res: Response) => res.json(await ProveedorService.cambiarEstado(idParam(req), true));

// ---------- Pedidos CU-30..33 ----------
export async function listarPedidos(req: Request, res: Response) {
  const estado = req.query.estado ? z.enum(ESTADOS_PEDIDO).parse(req.query.estado) : undefined;
  const lista = await PedidoService.listar({ estado, q: textoQuery(req.query.q) });
  // CU-33 2.1: sin pedidos pendientes → mensaje
  res.json(estado === 'pendiente' && lista.length === 0 ? { pedidos: [], mensaje: MENSAJES.SIN_PEDIDOS_PENDIENTES } : { pedidos: lista });
}
export const verPedido = async (req: Request, res: Response) => res.json(await PedidoService.ver(idParam(req)));
export const registrarPedido = async (req: Request, res: Response) =>
  res.status(201).json(await PedidoService.registrar(pedidoSchema.parse(req.body), usuarioActual(req)));
export const anularPedido = async (req: Request, res: Response) => res.json(await PedidoService.anular(idParam(req), anularPedidoSchema.parse(req.body).motivo));
export const recepcion = async (req: Request, res: Response) =>
  res.json(await PedidoService.registrarRecepcion(idParam(req), recepcionSchema.parse(req.body), usuarioActual(req)));

export async function pdfDePedido(req: Request, res: Response) {
  const p = await PedidoService.obtener(idParam(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${p.codigo}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(await pdfPedido(p));
}
/** CU-30 paso 4: enviar el pedido al proveedor por correo */
export async function enviarPedido(req: Request, res: Response) {
  const p = await PedidoService.obtener(idParam(req));
  if (!p.proveedor.email) throw new ErrorNegocio(422, 'PROVEEDOR_SIN_CORREO', MENSAJES.PROVEEDOR_SIN_CORREO);
  try {
    await enviarCorreo(
      p.proveedor.email,
      `Pedido ${p.codigo} — Clínica Dental`,
      `<p>Estimados ${escaparHtml(p.proveedor.razonSocial)}:</p><p>Adjuntamos nuestro pedido <b>${p.codigo}</b>. Por favor, confirmen disponibilidad y fecha de entrega.</p>`,
      [{ filename: `${p.codigo}.pdf`, content: await pdfPedido(p), contentType: 'application/pdf' }],
    );
  } catch {
    throw new ErrorNegocio(502, 'ERROR_CORREO', 'No se pudo enviar el correo; reintente');
  }
  res.json({ mensaje: `Pedido enviado a ${p.proveedor.email}` });
}

// ---------- CU-23 kárdex · CU-24 alertas · CU-25 ajuste ----------
const TIPOS_MOV = ['entrada_recepcion', 'salida_tratamiento', 'ajuste', 'merma', 'inicial'] as const;
export async function kardex(req: Request, res: Response) {
  const f = z
    .object({ desde: fechaSchema.optional(), hasta: hastaHoySchema.optional(), tipo: z.enum(TIPOS_MOV).optional() })
    .refine((r) => !r.desde || !r.hasta || r.desde <= r.hasta, { message: 'La fecha inicial debe ser anterior a la final', path: ['hasta'] })
    .parse({ desde: req.query.desde || undefined, hasta: req.query.hasta || undefined, tipo: req.query.tipo || undefined });
  res.json(await InsumoService.kardex(idParam(req), f));
}
export const alertas = async (req: Request, res: Response) => {
  const revisada = req.query.todas ? undefined : (boolQuery(req.query.revisada) ?? false);
  res.json(await InsumoService.alertas({ revisada }));
};
export const revisarAlerta = async (req: Request, res: Response) => res.json(await InsumoService.revisarAlerta(idParam(req), usuarioActual(req).id));
/** Volver a pendiente una alerta marcada como revisada por error */
export const reabrirAlerta = async (req: Request, res: Response) => res.json(await InsumoService.reabrirAlerta(idParam(req), usuarioActual(req).id, req.ip));
export const ajuste = async (req: Request, res: Response) =>
  res.status(201).json(await InsumoService.registrarAjuste(idParam(req), ajusteSchema.parse(req.body), usuarioActual(req).id));

// ---------- Usuarios CU-34..37 ----------
export async function listarUsuarios(req: Request, res: Response) {
  const rol = req.query.rol ? z.enum(ROLES).parse(req.query.rol) : undefined;
  res.json(await UsuarioService.listar({ q: textoQuery(req.query.q), rol, activo: boolQuery(req.query.activo) }));
}
export const crearUsuario = async (req: Request, res: Response) => res.status(201).json(await UsuarioService.crear(usuarioNuevoSchema.parse(req.body), usuarioActual(req), req.ip));
export const modificarUsuario = async (req: Request, res: Response) =>
  res.json(await UsuarioService.modificar(idParam(req), usuarioModificarSchema.parse(req.body), usuarioActual(req), req.ip));
export const desactivarUsuario = async (req: Request, res: Response) => res.json(await UsuarioService.cambiarEstado(idParam(req), false, usuarioActual(req), req.ip));
export const activarUsuario = async (req: Request, res: Response) => res.json(await UsuarioService.cambiarEstado(idParam(req), true, usuarioActual(req), req.ip));
/** CU-59 Traspasar el papel de administrador principal (RN-23) */
export const traspasarPrincipal = async (req: Request, res: Response) =>
  res.json(await UsuarioService.traspasarPrincipal(idParam(req), traspasoPrincipalSchema.parse(req.body).password, usuarioActual(req), req.ip));
/** Desbloquear una cuenta bloqueada por intentos fallidos */
export const desbloquearUsuario = async (req: Request, res: Response) => res.json(await AuthService.desbloquear(idParam(req), usuarioActual(req), req.ip));

// ---------- Auditoría ----------
const auditoriaQuery = z.object({
  dni: z.string().regex(/^\d{8}$/, 'El DNI tiene 8 dígitos').optional().or(z.literal('').transform(() => undefined)),
  usuarioId: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  accion: z.enum(ACCIONES_AUDITORIA).optional().or(z.literal('').transform(() => undefined)),
});
export async function auditoria(req: Request, res: Response) {
  const f = auditoriaQuery.parse(req.query);
  res.json(await AuditoriaService.listar({ ...f, ...rangoDe(req) }));
}

// ---------- Campañas de descuento, feriados, horarios y datos de pago ----------
export const listarDescuentos = async (_req: Request, res: Response) => res.json(await DescuentoService.listar());
export const crearDescuento = async (req: Request, res: Response) => res.status(201).json(await DescuentoService.crear(descuentoSchema.parse(req.body)));
export const modificarDescuento = async (req: Request, res: Response) => res.json(await DescuentoService.modificar(idParam(req), descuentoSchema.parse(req.body)));
export const desactivarDescuento = async (req: Request, res: Response) => res.json(await DescuentoService.cambiarEstado(idParam(req), false));
export const activarDescuento = async (req: Request, res: Response) => res.json(await DescuentoService.cambiarEstado(idParam(req), true));
export const verDatosPago = async (_req: Request, res: Response) => res.json(await PagoService.datosPago());
export async function guardarDatosPago(req: Request, res: Response) {
  res.json(await PagoService.guardarDatosPago(configPagoSchema.parse(req.body)));
}
/** QR de Yape/Plin de la clínica (imagen de hasta 2 MB) */
export const guardarQrPago = async (req: Request, res: Response) => res.json(await PagoService.guardarQr(qrPagoSchema.parse(req.body).qr));
export const quitarQrPago = async (_req: Request, res: Response) => res.json(await PagoService.quitarQr());

export async function listarFeriados(req: Request, res: Response) {
  const anio = req.query.anio ? z.coerce.number().int().min(2000).max(2100).parse(req.query.anio) : undefined;
  res.json(await AgendaService.listarFeriados(anio));
}
export async function crearFeriado(req: Request, res: Response) {
  const d = feriadoSchema.parse(req.body);
  res.status(201).json(await AgendaService.crearFeriado(d.fecha, d.nombre));
}
export async function eliminarFeriado(req: Request, res: Response) {
  await AgendaService.eliminarFeriado(idParam(req));
  res.status(204).end();
}
export const verHorario = async (req: Request, res: Response) => res.json(await AgendaService.verHorario(idParam(req)));
export const guardarHorario = async (req: Request, res: Response) => res.json(await AgendaService.guardarHorario(idParam(req), horarioSchema.parse(req.body)));

// ---------- CU-38..40 Panel y reportes ----------
export const panel = async (_req: Request, res: Response) => res.json(await ReporteService.panel());

function rangoDe(req: Request) {
  const hoy = ahoraLima().fecha;
  return rangoFechasSchema.parse({ desde: req.query.desde || `${hoy.slice(0, 8)}01`, hasta: req.query.hasta || hoy });
}
function enviarCsv(res: Response, nombre: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
  res.send(csv);
}

export async function reporteIngresos(req: Request, res: Response) {
  const { desde, hasta } = rangoDe(req);
  const r = await ReporteService.ingresos(desde, hasta);
  if (req.query.formato !== 'csv') return res.json(r);
  const fmt = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });
  enviarCsv(
    res,
    `ingresos_${desde}_${hasta}`,
    ReporteService.aCsv(
      ['Número', 'Fecha', 'Tipo', 'Paciente', 'DNI', 'Tipo de pago', 'Subtotal', 'Descuento', 'Adelanto aplicado', 'Total', 'Estado', 'Motivo de anulación'],
      r.detalle.map((d) => [d.numero, fmt.format(new Date(d.fecha)), d.tipo, d.paciente, d.dni, d.tipoPago, d.subtotal, d.descuento, d.adelantoAplicado, d.total, d.anulado ? 'Anulado' : 'Vigente', d.anulado?.motivo ?? '']),
    ),
  );
}

export async function reporteInventario(req: Request, res: Response) {
  const { desde, hasta } = rangoDe(req);
  const r = await ReporteService.inventario(desde, hasta);
  if (req.query.formato !== 'csv') return res.json(r);
  enviarCsv(
    res,
    `inventario_${desde}_${hasta}`,
    ReporteService.aCsv(
      ['Insumo', 'Unidad', 'Activo', 'Stock actual', 'Stock mínimo', 'Bajo mínimo', 'Entradas', 'Consumo', 'Ajustes', 'Mermas'],
      r.insumos.map((i) => [i.nombre, i.unidad, i.activo ? 'Sí' : 'No', i.stockActual, i.stockMinimo, i.bajoMinimo ? 'Sí' : 'No', i.entradas, i.consumo, i.ajustes, i.mermas]),
    ),
  );
}

/** GET /sunat/:ruc — razón social para autocompletar el registro de proveedores (si hay proveedor configurado) */
export async function sunat(req: Request, res: Response) {
  const ruc = z.string().regex(/^\d{11}$/, 'El RUC debe tener 11 dígitos').parse(req.params.ruc);
  res.json(await ReniecService.consultarRuc(ruc));
}
