// CU-13 Emitir comprobante — Recepcionista. RN-10, RN-11, RN-12, P2 (comprobante interno).
// Reglas acordadas: campañas por línea según la fecha de la cita; adelanto = 50 % del tratamiento previsto;
// el adelanto pagado y el saldo a favor se descuentan del cobro final; lo que sobra del adelanto → saldo a favor.
import { Prisma } from '@prisma/client';
import { MENSAJES, type ComprobanteDTO, type Importe, type UsuarioSesion } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, dateAHora, fechaPE } from '../lib/fechas.js';
import { enviarCorreo } from '../lib/correo.js';
import { horasParaCita } from './cita.service.js';
import { aplicarCampanas, campanasVigentes, edadEn } from './precio.service.js';
import { moverSaldo } from './saldo.service.js';
import { ahoraLima } from '../lib/fechas.js';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const CERO = D(0);
const sinCobro = () => new ErrorNegocio(409, 'CITA_SIN_COBRO', MENSAJES.CITA_SIN_COBRO);
const ESTADOS_ADELANTO = ['pendiente_adelanto', 'pago_en_verificacion'] as const;

const adelantoVencido = (c: { estado: string; adelantoVenceEn: Date | null }) =>
  c.estado === 'pendiente_adelanto' && !!c.adelantoVenceEn && c.adelantoVenceEn < new Date();

/** CU-13 paso 1 (c_listarPendientes): atendidas por cobrar, adelantos por cobrar y pagos reportados por verificar. */
export async function pendientes() {
  const citas = await prisma.cita.findMany({
    where: { estado: { in: ['atendida', ...ESTADOS_ADELANTO] } },
    orderBy: [{ fecha: 'asc' }, { hora: 'asc' }],
    include: {
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, saldoFavor: true } },
      odontologo: { include: { usuario: { select: { nombres: true } } } },
      atencion: { include: { tratamientos: true } },
      tratamientoPrevisto: { select: { nombre: true } },
    },
  });
  return citas
    .filter((c) => c.estado !== 'pendiente_adelanto' || (!adelantoVencido(c) && horasParaCita(c.fecha, c.hora) > 0))
    .map((c) => ({
      citaId: c.id,
      tipo: c.estado === 'atendida' ? ('servicio' as const) : ('adelanto' as const),
      estado: c.estado,
      fecha: dateAFecha(c.fecha),
      hora: dateAHora(c.hora),
      odontologo: c.odontologo.usuario.nombres,
      paciente: { id: c.paciente.id, dni: c.paciente.dni, nombres: c.paciente.nombres, apellidos: c.paciente.apellidos },
      saldoFavor: c.paciente.saldoFavor.toFixed(2),
      tratamientoPrevisto: c.tratamientoPrevisto?.nombre ?? null,
      adelantoVenceEn: c.estado === 'pendiente_adelanto' ? (c.adelantoVenceEn?.toISOString() ?? null) : null,
      pagoReportado: c.estado === 'pago_en_verificacion' && c.pagoOperacion ? { metodo: c.pagoMetodo, numeroOperacion: c.pagoOperacion } : null,
      // importe de lista (sin campañas ni saldo): referencia rápida para la lista
      importe:
        c.estado === 'atendida'
          ? (c.atencion?.tratamientos ?? []).reduce((s, t) => s.plus(t.precioAplicado), CERO).toFixed(2)
          : (c.montoAdelanto ?? CERO).toFixed(2),
    }));
}

/**
 * CU-13 paso 2 (c_calcularImporte). RN-10: importe = precios del tarifario (congelados en la atención) − campañas.
 * Luego se restan el adelanto pagado y el saldo a favor del paciente.
 */
export async function calcularImporte(db: Tx | typeof prisma, citaId: number): Promise<Importe> {
  const cita = await db.cita.findUnique({
    where: { id: citaId },
    include: {
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, email: true, fechaNacimiento: true, saldoFavor: true } },
      atencion: { include: { tratamientos: { include: { tratamiento: { select: { nombre: true } } }, orderBy: { id: 'asc' } } } },
      tratamientoPrevisto: { select: { nombre: true } },
      comprobantes: true,
    },
  });
  if (!cita) throw new ErrorNegocio(404, 'CITA_NO_ENCONTRADA', MENSAJES.CITA_NO_ENCONTRADA);
  const { fechaNacimiento: _f, saldoFavor, ...paciente } = cita.paciente;
  const fecha = dateAFecha(cita.fecha);

  if ((ESTADOS_ADELANTO as readonly string[]).includes(cita.estado)) {
    if (cita.comprobantes.some((c) => c.tipo === 'adelanto') || horasParaCita(cita.fecha, cita.hora) <= 0) throw sinCobro();
    if (adelantoVencido(cita)) throw new ErrorNegocio(409, 'ADELANTO_VENCIDO', MENSAJES.ADELANTO_VENCIDO);
    const monto = cita.montoAdelanto ?? CERO;
    if (monto.lessThanOrEqualTo(0)) throw sinCobro();
    return {
      citaId,
      tipo: 'adelanto',
      paciente,
      lineas: [
        {
          tratamientoId: null,
          descripcion: `Adelanto 50 % (${cita.tratamientoPrevisto?.nombre ?? 'tratamiento'}) — cita del ${fechaPE(fecha)} ${dateAHora(cita.hora)}`,
          precio: monto.toFixed(2),
          descuento: '0.00',
          campana: null,
        },
      ],
      subtotal: monto.toFixed(2),
      descuento: '0.00',
      adelantoAplicado: '0.00',
      saldoAplicado: '0.00',
      sobrante: '0.00',
      total: monto.toFixed(2),
      pagoReportado:
        cita.estado === 'pago_en_verificacion' && cita.pagoOperacion && cita.pagoReportadoEn && cita.pagoMetodo
          ? { metodo: cita.pagoMetodo, numeroOperacion: cita.pagoOperacion, reportadoEn: cita.pagoReportadoEn.toISOString(), tieneCaptura: !!cita.pagoCapturaTipo }
          : null,
    };
  }

  if (cita.estado !== 'atendida' || !cita.atencion) throw sinCobro();
  const lineas = cita.atencion.tratamientos;
  // 4.1: tratamiento sin precio → detener el cobro
  if (lineas.length === 0 || lineas.some((t) => t.precioAplicado.lessThanOrEqualTo(0))) {
    throw new ErrorNegocio(422, 'TRATAMIENTO_SIN_PRECIO', MENSAJES.TRATAMIENTO_SIN_PRECIO);
  }
  const campanas = await aplicarCampanas(
    db,
    lineas.map((t) => ({ tratamientoId: t.tratamientoId, precio: t.precioAplicado })),
    fecha,
    edadEn(cita.paciente.fechaNacimiento, fecha),
  );
  const subtotal = lineas.reduce((s, t) => s.plus(t.precioAplicado), CERO);
  const descuento = campanas.reduce((s, d) => s.plus(d.descuento), CERO);
  const base = subtotal.minus(descuento);

  const pagado = cita.comprobantes.find((c) => c.tipo === 'adelanto')?.total ?? CERO;
  const adelanto = Prisma.Decimal.min(pagado, base);
  const sobrante = pagado.minus(adelanto); // regla acordada: lo que sobra queda como saldo a favor
  const resto = base.minus(adelanto);
  const saldo = Prisma.Decimal.min(saldoFavor, resto);

  return {
    citaId,
    tipo: 'servicio',
    paciente,
    lineas: lineas.map((t, i) => ({
      tratamientoId: t.tratamientoId,
      descripcion: t.piezaDental ? `${t.tratamiento.nombre} — pieza ${t.piezaDental}` : t.tratamiento.nombre,
      precio: t.precioAplicado.toFixed(2),
      descuento: campanas[i].descuento.toFixed(2),
      campana: campanas[i].campana,
    })),
    subtotal: subtotal.toFixed(2),
    descuento: descuento.toFixed(2),
    adelantoAplicado: adelanto.toFixed(2),
    saldoAplicado: saldo.toFixed(2),
    sobrante: sobrante.toFixed(2),
    total: resto.minus(saldo).toFixed(2),
    pagoReportado: null,
  };
}

/**
 * CU-13 pasos 3–4 (c_emitirComprobante). En UNA transacción: comprobante correlativo + detalle,
 * movimientos de saldo a favor y cambio de estado de la cita
 * (servicio → «Pagada»; adelanto → «Confirmada», regla acordada: pagar el adelanto confirma la cita).
 */
export async function emitirComprobante(citaId: number, dto: ComprobanteDTO, usuario: UsuarioSesion, extra: { operacion?: string } = {}) {
  const id = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const importe = await calcularImporte(tx, citaId);
    const total = D(importe.total);

    const tipoPago = await tx.tipoPago.findUnique({ where: { id: dto.tipoPagoId } });
    if (!tipoPago) throw new ErrorNegocio(422, 'TIPO_PAGO_NO_VALIDO', MENSAJES.TIPO_PAGO_NO_VALIDO, { tipoPagoId: MENSAJES.TIPO_PAGO_NO_VALIDO });

    // En efectivo se calcula el vuelto; con tarjeta o Yape/Plin se cobra el total exacto
    const efectivo = tipoPago.nombre.toLowerCase() === 'efectivo';
    const recibido = efectivo ? D(dto.montoRecibido ?? -1) : total;
    if (recibido.lessThan(total)) {
      throw new ErrorNegocio(422, 'MONTO_INSUFICIENTE', MENSAJES.MONTO_INSUFICIENTE, { montoRecibido: MENSAJES.MONTO_INSUFICIENTE }); // 6.1
    }

    // Correlativo sin huecos (P2: C-000001): bloqueo consultivo mientras dura la transacción
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(130013)`;
    const n = (await tx.comprobante.count()) + 1;

    const comprobante = await tx.comprobante.create({
      data: {
        numero: `C-${String(n).padStart(6, '0')}`,
        tipo: importe.tipo,
        citaId,
        pacienteId: importe.paciente.id,
        tipoPagoId: tipoPago.id,
        subtotal: importe.subtotal,
        descuento: importe.descuento,
        adelantoAplicado: importe.adelantoAplicado,
        saldoAplicado: importe.saldoAplicado,
        total,
        montoRecibido: recibido,
        vuelto: recibido.minus(total),
        operacion: extra.operacion ?? null,
        emitidoPorId: usuario.id,
      },
    });
    // Detalle con el descuento de campaña de cada línea
    const campanasPorNombre = new Map((await tx.descuento.findMany({ select: { id: true, nombre: true } })).map((d) => [d.nombre, d.id]));
    await tx.detalleComprobante.createMany({
      data: importe.lineas.map((l) => ({
        comprobanteId: comprobante.id,
        tratamientoId: l.tratamientoId,
        descripcion: l.descripcion,
        precio: l.precio,
        descuento: l.descuento,
        descuentoId: l.campana ? (campanasPorNombre.get(l.campana) ?? null) : null,
      })),
    });

    if (importe.tipo === 'servicio') {
      await moverSaldo(tx, { pacienteId: importe.paciente.id, tipo: 'uso_en_cobro', monto: D(importe.saldoAplicado).neg(), usuarioId: usuario.id, citaId, comprobanteId: comprobante.id, motivo: `Usado en ${comprobante.numero}` });
      await moverSaldo(tx, { pacienteId: importe.paciente.id, tipo: 'abono_sobrante', monto: importe.sobrante, usuarioId: usuario.id, citaId, comprobanteId: comprobante.id, motivo: `Adelanto no usado en ${comprobante.numero}` });
      await tx.cita.update({ where: { id: citaId }, data: { estado: 'pagada' } });
    } else {
      await tx.cita.update({ where: { id: citaId }, data: { estado: 'confirmada', adelantoVenceEn: null } });
    }
    return comprobante.id;
  });
  return obtenerComprobante(id);
}

/** Pago reportado por el paciente (Yape/Plin): la recepcionista verificó que llegó → se emite el comprobante del adelanto. */
export async function aprobarPago(citaId: number, usuario: UsuarioSesion) {
  const cita = await prisma.cita.findUnique({ where: { id: citaId } });
  if (!cita || cita.estado !== 'pago_en_verificacion') throw new ErrorNegocio(409, 'PAGO_NO_VERIFICABLE', MENSAJES.PAGO_NO_VERIFICABLE);
  const tipo = await prisma.tipoPago.findFirst({ where: { nombre: { contains: 'Yape', mode: 'insensitive' } } });
  if (!tipo) throw new ErrorNegocio(422, 'TIPO_PAGO_NO_VALIDO', MENSAJES.TIPO_PAGO_NO_VALIDO);
  return emitirComprobante(citaId, { tipoPagoId: tipo.id }, usuario, { operacion: cita.pagoOperacion ?? undefined });
}

/** El pago reportado no llegó o no corresponde → la cita se libera y se avisa al paciente. */
export async function rechazarPago(citaId: number, motivo: string) {
  const cita = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const c = await tx.cita.findUnique({ where: { id: citaId }, include: { paciente: true } });
    if (!c || c.estado !== 'pago_en_verificacion') throw new ErrorNegocio(409, 'PAGO_NO_VERIFICABLE', MENSAJES.PAGO_NO_VERIFICABLE);
    await tx.cita.update({ where: { id: citaId }, data: { estado: 'liberada', pagoRechazoMotivo: motivo, adelantoVenceEn: null } });
    return c;
  });
  if (cita.paciente.email) {
    await enviarCorreo(
      cita.paciente.email,
      'No pudimos verificar su pago — Clínica Dental',
      `<p>Hola ${cita.paciente.nombres}:</p><p>No pudimos verificar el pago del adelanto de su cita del <b>${fechaPE(dateAFecha(cita.fecha))} a las ${dateAHora(cita.hora)}</b> (operación ${cita.pagoOperacion}).</p><p>Motivo: ${motivo}</p><p>El horario fue liberado. Si cree que es un error, comuníquese con la clínica.</p>`,
    ).catch(() => undefined);
  }
  return { citaId, estado: 'liberada' as const };
}

/** Captura del pago reportado (solo para verificarlo en caja). */
export async function capturaPago(citaId: number) {
  const c = await prisma.cita.findUnique({ where: { id: citaId }, select: { pagoCaptura: true, pagoCapturaTipo: true } });
  if (!c?.pagoCaptura || !c.pagoCapturaTipo) throw new ErrorNegocio(404, 'NO_ENCONTRADO', 'El pago no tiene captura');
  return { datos: Buffer.from(c.pagoCaptura), tipo: c.pagoCapturaTipo };
}

const INCLUIR = {
  paciente: { select: { dni: true, nombres: true, apellidos: true, email: true, saldoFavor: true } },
  tipoPago: true,
  emitidoPor: { select: { nombres: true } },
  detalles: { orderBy: { id: 'asc' as const }, include: { campana: { select: { nombre: true } } } },
  cita: { select: { estado: true } },
} as const;
export type ComprobanteCompleto = Prisma.ComprobanteGetPayload<{ include: typeof INCLUIR }>;

export async function buscarComprobante(id: number) {
  const c = await prisma.comprobante.findUnique({ where: { id }, include: INCLUIR });
  if (!c) throw new ErrorNegocio(404, 'COMPROBANTE_NO_ENCONTRADO', MENSAJES.COMPROBANTE_NO_ENCONTRADO);
  return c;
}

export async function obtenerComprobante(id: number) {
  const c = await buscarComprobante(id);
  const sobrante = await prisma.saldoMovimiento.findFirst({ where: { comprobanteId: c.id, tipo: 'abono_sobrante' } });
  return {
    id: c.id,
    numero: c.numero,
    tipo: c.tipo,
    citaId: c.citaId,
    estadoCita: c.cita.estado,
    fecha: c.createdAt.toISOString(),
    paciente: { dni: c.paciente.dni, nombres: c.paciente.nombres, apellidos: c.paciente.apellidos, tieneCorreo: !!c.paciente.email, saldoFavor: c.paciente.saldoFavor.toFixed(2) },
    tipoPago: c.tipoPago.nombre,
    operacion: c.operacion,
    lineas: c.detalles.map((d) => ({ descripcion: d.descripcion, precio: d.precio.toFixed(2), descuento: d.descuento.toFixed(2), campana: d.campana?.nombre ?? null })),
    subtotal: c.subtotal.toFixed(2),
    descuento: c.descuento.toFixed(2),
    adelantoAplicado: c.adelantoAplicado.toFixed(2),
    saldoAplicado: c.saldoAplicado.toFixed(2),
    saldoGenerado: sobrante?.monto.toFixed(2) ?? '0.00',
    total: c.total.toFixed(2),
    montoRecibido: c.montoRecibido.toFixed(2),
    vuelto: c.vuelto.toFixed(2),
    enviadoEmail: c.enviadoEmail,
    emitidoPor: c.emitidoPor.nombres,
  };
}

export async function marcarEnviado(id: number) {
  await prisma.comprobante.update({ where: { id }, data: { enviadoEmail: true } });
}

export const tiposPago = () => prisma.tipoPago.findMany({ orderBy: { id: 'asc' } });

/** Campañas vigentes hoy (informativo para la recepcionista; se aplican solas). */
export async function campanasDeHoy() {
  const lista = await campanasVigentes(prisma, ahoraLima().fecha, 0);
  const todas = await prisma.descuento.findMany({
    where: { id: { in: lista.map((c) => c.id) } },
    include: { tratamientos: { include: { tratamiento: { select: { nombre: true } } } } },
  });
  return todas.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    tipo: d.tipo,
    porcentaje: d.porcentaje?.toFixed(2) ?? null,
    hasta: dateAFecha(d.fechaFin),
    edadMaxima: d.edadMaxima,
    tratamientos: d.tratamientos.map((t) => t.tratamiento.nombre),
  }));
}
