// CU-13 Emitir comprobante — Recepcionista. RN-10, RN-11, RN-12, RN-16, RN-17, P2 (comprobante interno).
// CU-42 Verificar pago de adelanto (RN-18) · CU-43 Anular comprobante (RN-19).
// Reglas acordadas: campañas por línea según la fecha de la cita; adelanto = 50 % del tratamiento previsto;
// el adelanto pagado y el saldo a favor se descuentan del cobro final; lo que sobra del adelanto → saldo a favor.
import { Prisma } from '@prisma/client';
import { MENSAJES, type ComprobanteDTO, type Importe, type UsuarioSesion, VUELTO_MAXIMO } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, dateAHora, fechaPE } from '../lib/fechas.js';
import { enviarCorreo } from '../lib/correo.js';
import { horasParaCita } from './cita.service.js';
import { aplicarCampanas, campanasVigentes, edadEn } from './precio.service.js';
import { moverSaldo } from './saldo.service.js';
import { tipoPagoBilletera } from './pago.service.js';
import { ahoraLima } from '../lib/fechas.js';
import { registrar as registrarAuditoria } from './auditoria.service.js';
import { escaparHtml } from '../lib/html.js';
import { MINUTOS_PAGO_ADELANTO } from '@clinica/shared';

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
      comprobantes: { where: { anuladoEn: null } }, // los anulados no cuentan
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
    // El saldo a favor del paciente se usa primero para el adelanto
    const saldoAdelanto = Prisma.Decimal.min(saldoFavor, monto);
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
      saldoAplicado: saldoAdelanto.toFixed(2),
      sobrante: '0.00',
      total: monto.minus(saldoAdelanto).toFixed(2),
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

  // Valor del adelanto pagado: lo cobrado + el saldo a favor usado en él
  const pagado = cita.comprobantes.find((c) => c.tipo === 'adelanto')?.subtotal ?? CERO;
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
    // «Saldo a favor» solo vale cuando el saldo cubre todo (total 0); no se elige a mano
    if (!tipoPago || (tipoPago.nombre === TIPO_SALDO && !total.isZero())) {
      throw new ErrorNegocio(422, 'TIPO_PAGO_NO_VALIDO', MENSAJES.TIPO_PAGO_NO_VALIDO, { tipoPagoId: MENSAJES.TIPO_PAGO_NO_VALIDO });
    }

    // En efectivo se calcula el vuelto; con tarjeta o Yape/Plin se cobra el total exacto
    const efectivo = tipoPago.nombre.toLowerCase() === 'efectivo';
    const recibido = efectivo ? D(dto.montoRecibido ?? -1) : total;
    if (recibido.lessThan(total)) {
      throw new ErrorNegocio(422, 'MONTO_INSUFICIENTE', MENSAJES.MONTO_INSUFICIENTE, { montoRecibido: MENSAJES.MONTO_INSUFICIENTE }); // 6.1
    }
    if (efectivo && recibido.greaterThan(total.plus(VUELTO_MAXIMO))) {
      const m = MENSAJES.montoFueraDeRango(total.toFixed(2), total.plus(VUELTO_MAXIMO).toFixed(2));
      throw new ErrorNegocio(422, 'MONTO_FUERA_DE_RANGO', m, { montoRecibido: m });
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
      await moverSaldo(tx, { pacienteId: importe.paciente.id, tipo: 'uso_en_cobro', monto: D(importe.saldoAplicado).neg(), usuarioId: usuario.id, citaId, comprobanteId: comprobante.id, motivo: `Usado en el adelanto ${comprobante.numero}` });
      await tx.cita.update({ where: { id: citaId }, data: { estado: 'confirmada', adelantoVenceEn: null } });
    }
    return comprobante.id;
  });
  return obtenerComprobante(id);
}

const TIPO_SALDO = 'Saldo a favor';

/** El saldo a favor cubre todo el adelanto: comprobante por S/ 0.00 pagado con saldo y la cita queda «Confirmada». */
export async function pagarAdelantoConSaldo(citaId: number, usuario: UsuarioSesion) {
  const importe = await calcularImporte(prisma, citaId);
  if (importe.tipo !== 'adelanto' || !D(importe.total).isZero()) return null;
  const tipo = await prisma.tipoPago.upsert({ where: { nombre: TIPO_SALDO }, update: {}, create: { nombre: TIPO_SALDO } });
  return emitirComprobante(citaId, { tipoPagoId: tipo.id }, usuario);
}

/** Pago reportado por el paciente (Yape/Plin): la recepcionista verificó que llegó → se emite el comprobante del adelanto. */
export async function aprobarPago(citaId: number, usuario: UsuarioSesion) {
  const cita = await prisma.cita.findUnique({ where: { id: citaId } });
  if (!cita || cita.estado !== 'pago_en_verificacion') throw new ErrorNegocio(409, 'PAGO_NO_VERIFICABLE', MENSAJES.PAGO_NO_VERIFICABLE);
  const tipo = await tipoPagoBilletera();
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
      `<p>Hola ${escaparHtml(cita.paciente.nombres)}:</p><p>No pudimos verificar el pago del adelanto de su cita del <b>${fechaPE(dateAFecha(cita.fecha))} a las ${dateAHora(cita.hora)}</b> (operación ${escaparHtml(cita.pagoOperacion)}).</p><p>Motivo: ${escaparHtml(motivo)}</p><p>El horario fue liberado. Si cree que es un error, comuníquese con la clínica.</p>`,
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
  anuladoPor: { select: { nombres: true } },
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
    anulado: c.anuladoEn ? { fecha: c.anuladoEn.toISOString(), por: c.anuladoPor?.nombres ?? '', motivo: c.motivoAnulacion ?? '' } : null,
  };
}

export async function marcarEnviado(id: number) {
  await prisma.comprobante.update({ where: { id }, data: { enviadoEmail: true } });
}

/** Tipos de pago que se eligen en caja («Saldo a favor» se aplica solo, no se elige). */
export const tiposPago = () => prisma.tipoPago.findMany({ where: { nombre: { not: TIPO_SALDO } }, orderBy: { id: 'asc' } });

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

const fechaLimaDe = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);

/** Comprobantes emitidos en un día (hora de Lima), con los anulados marcados. */
export async function comprobantesDelDia(fecha: string, usuario: UsuarioSesion) {
  const lista = await prisma.comprobante.findMany({
    where: { createdAt: { gte: new Date(`${fecha}T00:00:00-05:00`), lt: new Date(new Date(`${fecha}T00:00:00-05:00`).getTime() + 86_400_000) } },
    orderBy: { id: 'desc' },
    include: { paciente: { select: { dni: true, nombres: true, apellidos: true } }, tipoPago: true, anuladoPor: { select: { nombres: true } } },
  });
  const hoy = ahoraLima().fecha;
  return lista.map((c) => ({
    id: c.id,
    numero: c.numero,
    tipo: c.tipo,
    citaId: c.citaId,
    fecha: c.createdAt.toISOString(),
    paciente: `${c.paciente.apellidos}, ${c.paciente.nombres}`,
    dni: c.paciente.dni,
    tipoPago: c.tipoPago.nombre,
    total: c.total.toFixed(2),
    anulado: c.anuladoEn ? { fecha: c.anuladoEn.toISOString(), por: c.anuladoPor?.nombres ?? '', motivo: c.motivoAnulacion ?? '' } : null,
    puedeAnular: !c.anuladoEn && (usuario.rol === 'administrador' || fechaLimaDe(c.createdAt) === hoy),
  }));
}

/**
 * Anular un comprobante emitido por error. No se borra: conserva su número (la numeración no tiene huecos),
 * deja de contar en los ingresos y su PDF muestra «ANULADO». En UNA transacción:
 * - Servicio: el saldo a favor usado vuelve al paciente, el saldo generado (sobrante del adelanto) se retira
 *   y la cita vuelve a «Atendida» (pendiente de cobro), para emitir el comprobante correcto.
 * - Adelanto: si la cita aún no ocurre, vuelve a «Pendiente de adelanto» con un nuevo plazo de 1 hora;
 *   si ya fue atendida y no se cobró, sigue «Atendida» y el cobro final ya no descuenta ese adelanto.
 * Recepcionista: solo comprobantes de hoy. Administrador: cualquiera. Siempre con motivo (queda en la auditoría).
 */
export async function anularComprobante(id: number, motivo: string, usuario: UsuarioSesion, ip?: string) {
  await prisma.$transaction(async (tx) => {
    const [fila] = await tx.$queryRaw<{ cita_id: number }[]>`SELECT cita_id FROM comprobantes WHERE id = ${id} FOR UPDATE`;
    if (!fila) throw new ErrorNegocio(404, 'COMPROBANTE_NO_ENCONTRADO', MENSAJES.COMPROBANTE_NO_ENCONTRADO);
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${fila.cita_id} FOR UPDATE`;
    const c = await tx.comprobante.findUniqueOrThrow({
      where: { id },
      include: { movimientosSaldo: true, cita: { include: { comprobantes: { where: { anuladoEn: null } } } } },
    });
    if (c.anuladoEn) throw new ErrorNegocio(409, 'COMPROBANTE_YA_ANULADO', MENSAJES.COMPROBANTE_YA_ANULADO);
    if (usuario.rol !== 'administrador' && fechaLimaDe(c.createdAt) !== ahoraLima().fecha) {
      throw new ErrorNegocio(403, 'ANULACION_SOLO_HOY', MENSAJES.ANULACION_SOLO_HOY);
    }

    // Lo que este comprobante movió en el saldo a favor (uso −, sobrante +) se revierte
    const revertirSaldo = async () => {
      const neto = c.movimientosSaldo.reduce((s, m) => s.plus(m.monto), CERO);
      if (neto.isZero()) return;
      const [p] = await tx.$queryRaw<{ saldo_favor: Prisma.Decimal }[]>`SELECT saldo_favor FROM pacientes WHERE id = ${c.pacienteId} FOR UPDATE`;
      if (D(p.saldo_favor).minus(neto).isNegative()) throw new ErrorNegocio(409, 'SALDO_YA_USADO', MENSAJES.SALDO_YA_USADO);
      await moverSaldo(tx, { pacienteId: c.pacienteId, tipo: 'reversion_anulacion', monto: neto.neg(), usuarioId: usuario.id, citaId: c.citaId, comprobanteId: c.id, motivo: `Anulación de ${c.numero}` });
    };

    if (c.tipo === 'servicio') {
      await revertirSaldo();
      await tx.cita.update({ where: { id: c.citaId }, data: { estado: 'atendida' } });
    } else {
      const cita = c.cita;
      if (cita.comprobantes.some((x) => x.tipo === 'servicio')) throw new ErrorNegocio(409, 'ANULAR_SERVICIO_PRIMERO', MENSAJES.ANULAR_SERVICIO_PRIMERO);
      if (!(cita.estado === 'confirmada' && horasParaCita(cita.fecha, cita.hora) > 0) && cita.estado !== 'atendida') {
        throw new ErrorNegocio(409, 'ANULACION_CITA_PASADA', MENSAJES.ANULACION_CITA_PASADA);
      }
      await revertirSaldo();
      if (cita.estado === 'confirmada' && horasParaCita(cita.fecha, cita.hora) > 0) {
        await tx.cita.update({
          where: { id: cita.id },
          data: {
            estado: 'pendiente_adelanto',
            adelantoVenceEn: new Date(Date.now() + MINUTOS_PAGO_ADELANTO * 60_000),
            pagoMetodo: null,
            pagoOperacion: null,
            pagoCaptura: null,
            pagoCapturaTipo: null,
            pagoReportadoEn: null,
          },
        });
      } else if (cita.estado !== 'atendida') {
        throw new ErrorNegocio(409, 'ANULACION_CITA_PASADA', MENSAJES.ANULACION_CITA_PASADA);
      }
    }

    await tx.comprobante.update({ where: { id }, data: { anuladoEn: new Date(), anuladoPorId: usuario.id, motivoAnulacion: motivo } });
    await registrarAuditoria(tx, {
      usuarioId: usuario.id,
      accion: 'anular_comprobante',
      pacienteId: c.pacienteId,
      detalle: `${c.numero} (${c.tipo}, S/ ${c.total.toFixed(2)}): ${motivo}`,
      ip,
    });
  });
  return obtenerComprobante(id);
}
