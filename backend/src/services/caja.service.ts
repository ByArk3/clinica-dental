// CU-13 Emitir comprobante — Recepcionista. RN-10, RN-11, RN-12 (adelanto), P2 (comprobante interno), P3, P6.
import { Prisma } from '@prisma/client';
import { MENSAJES, type ComprobanteDTO, type Importe, type UsuarioSesion } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, dateAHora } from '../lib/fechas.js';
import { estadoInicial, horasParaCita } from './cita.service.js';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const CERO = D(0);
const sinCobro = () => new ErrorNegocio(409, 'CITA_SIN_COBRO', MENSAJES.CITA_SIN_COBRO);

/** Monto fijo del adelanto (P6), configurable en la tabla `configuracion`. */
async function montoAdelanto(db: Tx | typeof prisma) {
  const c = await db.configuracion.findUnique({ where: { clave: 'monto_adelanto' } });
  return D(c?.valor ?? '30.00');
}

/** CU-13 paso 1 (c_listarPendientes): citas «Atendida» por cobrar y «Pendiente de adelanto» futuras. */
export async function pendientes() {
  const citas = await prisma.cita.findMany({
    where: { estado: { in: ['atendida', 'pendiente_adelanto'] } },
    orderBy: [{ fecha: 'asc' }, { hora: 'asc' }],
    include: {
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true } },
      odontologo: { include: { usuario: { select: { nombres: true } } } },
      atencion: { include: { tratamientos: true } },
    },
  });
  const adelanto = await montoAdelanto(prisma);
  return citas
    .filter((c) => c.estado === 'atendida' || horasParaCita(c.fecha, c.hora) > 0)
    .map((c) => ({
      citaId: c.id,
      tipo: c.estado === 'atendida' ? ('servicio' as const) : ('adelanto' as const),
      fecha: dateAFecha(c.fecha),
      hora: dateAHora(c.hora),
      odontologo: c.odontologo.usuario.nombres,
      paciente: c.paciente,
      importe:
        c.estado === 'atendida'
          ? (c.atencion?.tratamientos ?? []).reduce((s, t) => s.plus(t.precioAplicado), CERO).toFixed(2)
          : adelanto.toFixed(2),
    }));
}

/**
 * CU-13 paso 2 (c_calcularImporte). RN-10: importe = precios del tarifario − descuento.
 * Se usan los precios CONGELADOS en la atención (el tarifario pudo cambiar después).
 * P6: si el paciente pagó un adelanto para esta cita, se descuenta del cobro final.
 */
export async function calcularImporte(db: Tx | typeof prisma, citaId: number, descuentoId?: number | null): Promise<Importe> {
  const cita = await db.cita.findUnique({
    where: { id: citaId },
    include: {
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, email: true } },
      atencion: { include: { tratamientos: { include: { tratamiento: { select: { nombre: true } } }, orderBy: { id: 'asc' } } } },
      comprobantes: true,
    },
  });
  if (!cita) throw new ErrorNegocio(404, 'CITA_NO_ENCONTRADA', MENSAJES.CITA_NO_ENCONTRADA);

  if (cita.estado === 'pendiente_adelanto') {
    // Ya pagado, o la cita ya pasó sin pagarse: no hay nada que cobrar
    if (cita.comprobantes.some((c) => c.tipo === 'adelanto') || horasParaCita(cita.fecha, cita.hora) <= 0) throw sinCobro();
    const monto = await montoAdelanto(db);
    return {
      citaId,
      tipo: 'adelanto',
      paciente: cita.paciente,
      lineas: [{ tratamientoId: null, descripcion: `Adelanto de reserva — cita del ${dateAFecha(cita.fecha).split('-').reverse().join('/')} ${dateAHora(cita.hora)}`, precio: monto.toFixed(2) }],
      subtotal: monto.toFixed(2),
      descuento: '0.00',
      descuentoAplicado: null, // al adelanto no se le aplican descuentos
      adelantoAplicado: '0.00',
      total: monto.toFixed(2),
    };
  }

  if (cita.estado !== 'atendida' || !cita.atencion) throw sinCobro();
  const lineas = cita.atencion.tratamientos;
  // 4.1: tratamiento sin precio → detener el cobro
  if (lineas.length === 0 || lineas.some((t) => t.precioAplicado.lessThanOrEqualTo(0))) {
    throw new ErrorNegocio(422, 'TRATAMIENTO_SIN_PRECIO', MENSAJES.TRATAMIENTO_SIN_PRECIO);
  }
  const subtotal = lineas.reduce((s, t) => s.plus(t.precioAplicado), CERO);

  // P3: un solo descuento por cobro, elegido por la recepcionista entre los activos
  let descuento = CERO;
  let descuentoAplicado: Importe['descuentoAplicado'] = null;
  if (descuentoId) {
    const d = await db.descuento.findUnique({ where: { id: descuentoId } });
    if (!d || !d.activo) throw new ErrorNegocio(422, 'DESCUENTO_NO_VALIDO', MENSAJES.DESCUENTO_NO_VALIDO);
    descuento = subtotal.times(d.porcentaje).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    descuentoAplicado = { id: d.id, nombre: d.nombre, porcentaje: d.porcentaje.toFixed(2) };
  }

  const pagado = cita.comprobantes.find((c) => c.tipo === 'adelanto')?.total ?? CERO;
  const adelanto = Prisma.Decimal.min(pagado, subtotal.minus(descuento)); // nunca deja el total negativo

  return {
    citaId,
    tipo: 'servicio',
    paciente: cita.paciente,
    lineas: lineas.map((t) => ({
      tratamientoId: t.tratamientoId,
      descripcion: t.piezaDental ? `${t.tratamiento.nombre} — pieza ${t.piezaDental}` : t.tratamiento.nombre,
      precio: t.precioAplicado.toFixed(2),
    })),
    subtotal: subtotal.toFixed(2),
    descuento: descuento.toFixed(2),
    descuentoAplicado,
    adelantoAplicado: adelanto.toFixed(2),
    total: subtotal.minus(descuento).minus(adelanto).toFixed(2),
  };
}

/**
 * CU-13 pasos 3–4 (c_emitirComprobante). En UNA transacción:
 * comprobante con número correlativo + detalle, y cambio de estado de la cita
 * (servicio → «Pagada»; adelanto → vuelve a requerir confirmación, 3.1).
 */
export async function emitirComprobante(citaId: number, dto: ComprobanteDTO, usuario: UsuarioSesion) {
  const id = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const importe = await calcularImporte(tx, citaId, dto.descuentoId);
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
        descuentoId: importe.descuentoAplicado?.id ?? null,
        subtotal: importe.subtotal,
        descuento: importe.descuento,
        adelantoAplicado: importe.adelantoAplicado,
        total,
        montoRecibido: recibido,
        vuelto: recibido.minus(total),
        emitidoPorId: usuario.id,
        detalles: { create: importe.lineas.map((l) => ({ tratamientoId: l.tratamientoId, descripcion: l.descripcion, precio: l.precio })) },
      },
    });

    if (importe.tipo === 'servicio') {
      await tx.cita.update({ where: { id: citaId }, data: { estado: 'pagada' } });
    } else {
      // 3.1: adelanto pagado → la cita sigue el flujo normal de confirmación (RN-04)
      const cita = await tx.cita.findUniqueOrThrow({ where: { id: citaId } });
      await tx.cita.update({
        where: { id: citaId },
        data: { estado: estadoInicial(false, dateAFecha(cita.fecha), dateAHora(cita.hora)) },
      });
    }
    return comprobante.id;
  });
  return obtenerComprobante(id);
}

const INCLUIR = {
  paciente: { select: { dni: true, nombres: true, apellidos: true, email: true } },
  tipoPago: true,
  descuentoAplicado: true,
  emitidoPor: { select: { nombres: true } },
  detalles: { orderBy: { id: 'asc' as const } },
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
  return {
    id: c.id,
    numero: c.numero,
    tipo: c.tipo,
    citaId: c.citaId,
    estadoCita: c.cita.estado,
    fecha: c.createdAt.toISOString(),
    paciente: { dni: c.paciente.dni, nombres: c.paciente.nombres, apellidos: c.paciente.apellidos, tieneCorreo: !!c.paciente.email },
    tipoPago: c.tipoPago.nombre,
    descuento: c.descuentoAplicado ? { nombre: c.descuentoAplicado.nombre, monto: c.descuento.toFixed(2) } : null,
    lineas: c.detalles.map((d) => ({ descripcion: d.descripcion, precio: d.precio.toFixed(2) })),
    subtotal: c.subtotal.toFixed(2),
    adelantoAplicado: c.adelantoAplicado.toFixed(2),
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
export async function descuentosActivos() {
  const lista = await prisma.descuento.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
  return lista.map((d) => ({ id: d.id, nombre: d.nombre, porcentaje: d.porcentaje.toFixed(2) }));
}
