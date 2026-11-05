// CU-11 Registrar tratamiento (atención) — Odontólogo. RN-06, RN-08, RN-09.
import { Prisma } from '@prisma/client';
import { MENSAJES, type AtencionDTO, type EditarAtencionDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { ahoraLima, dateAFecha, dateAHora, fechaADate } from '../lib/fechas.js';
import { registrarMovimiento, type ResultadoMovimiento } from './stock.service.js';
import { registrar as registrarAuditoria } from './auditoria.service.js';

const noDisponible = () => new ErrorNegocio(409, 'CITA_NO_ATENCION', MENSAJES.CITA_NO_ATENCION);

/** CU-11 paso 1: «Mis citas del día» del odontólogo en sesión (confirmadas por atender y ya atendidas). */
export async function citasDelOdontologo(odontologoId: number, fecha: string) {
  const citas = await prisma.cita.findMany({
    where: { odontologoId, fecha: fechaADate(fecha), estado: { in: ['confirmada', 'atendida', 'pagada'] } },
    orderBy: { hora: 'asc' },
    include: {
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, fechaNacimiento: true, ficha: { select: { alergias: true } } } },
      atencion: { select: { id: true } },
    },
  });
  const hoy = ahoraLima().fecha;
  return citas.map((c) => ({
    id: c.id,
    fecha: dateAFecha(c.fecha),
    hora: dateAHora(c.hora),
    motivo: c.motivo,
    estado: c.estado,
    puedeAtender: c.estado === 'confirmada' && dateAFecha(c.fecha) <= hoy,
    atencionId: c.atencion?.id ?? null, // para corregirla
    paciente: {
      id: c.paciente.id,
      dni: c.paciente.dni,
      nombres: c.paciente.nombres,
      apellidos: c.paciente.apellidos,
      fechaNacimiento: dateAFecha(c.paciente.fechaNacimiento),
      alergias: c.paciente.ficha?.alergias ?? null,
    },
  }));
}

/**
 * CU-11 paso 4, en UNA transacción: Atencion + AtencionTratamiento (precio congelado),
 * cita → «Atendida», y por cada insumo de cada tratamiento una salida de stock (CU-12, RN-09).
 * Si algo falla, no queda nada a medias.
 */
export async function registrarAtencion(citaId: number, usuario: UsuarioSesion, dto: AtencionDTO) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${citaId} FOR UPDATE`;
    const cita = await tx.cita.findUnique({ where: { id: citaId }, include: { paciente: { include: { ficha: true } } } });
    // RN-06: solo el odontólogo de la cita; la cita debe estar confirmada y no ser de un día futuro
    if (!cita || cita.odontologoId !== usuario.odontologoId) throw noDisponible();
    if (cita.estado !== 'confirmada' || dateAFecha(cita.fecha) > ahoraLima().fecha) throw noDisponible();
    const ficha = cita.paciente.ficha;
    if (!ficha) throw new ErrorNegocio(500, 'SIN_FICHA', 'El paciente no tiene ficha (RN-05)');

    // RN-08: solo tratamientos activos del tarifario
    const ids = [...new Set(dto.tratamientos.map((t) => t.tratamientoId))];
    const tarifario = await tx.tratamiento.findMany({ where: { id: { in: ids }, activo: true }, include: { insumos: true } });
    if (tarifario.length !== ids.length) throw new ErrorNegocio(422, 'TRATAMIENTO_NO_TARIFARIO', MENSAJES.TRATAMIENTO_NO_TARIFARIO);
    const porId = new Map(tarifario.map((t) => [t.id, t]));

    const atencion = await tx.atencion.create({
      data: {
        citaId,
        fichaId: ficha.id,
        odontologoId: cita.odontologoId,
        diagnostico: dto.diagnostico,
        observaciones: dto.observaciones || null,
        tratamientos: {
          create: dto.tratamientos.map((t) => ({
            tratamientoId: t.tratamientoId,
            piezaDental: t.piezaDental ?? null,
            precioAplicado: porId.get(t.tratamientoId)!.precio, // precio congelado
          })),
        },
      },
    });
    await tx.cita.update({ where: { id: citaId }, data: { estado: 'atendida' } });

    // 5.1: varios tratamientos → se descuentan los insumos de cada uno (sumados por insumo)
    const consumo = new Map<number, Prisma.Decimal>();
    for (const t of dto.tratamientos) {
      for (const i of porId.get(t.tratamientoId)!.insumos) {
        consumo.set(i.insumoId, (consumo.get(i.insumoId) ?? new Prisma.Decimal(0)).plus(i.cantidad));
      }
    }
    const movimientos: ResultadoMovimiento[] = [];
    for (const [insumoId, cantidad] of [...consumo].sort((a, b) => a[0] - b[0])) {
      movimientos.push(
        await registrarMovimiento(tx, {
          insumoId,
          tipo: 'salida_tratamiento',
          cantidad,
          usuarioId: usuario.id,
          motivo: `Atención de la cita #${citaId}`,
          referencia: { tipo: 'atencion', id: atencion.id },
        }),
      );
    }

    return {
      atencionId: atencion.id,
      citaId,
      estado: 'atendida' as const,
      total: dto.tratamientos.reduce((s, t) => s.plus(porId.get(t.tratamientoId)!.precio), new Prisma.Decimal(0)).toFixed(2),
      insumos: movimientos,
      alertas: movimientos.filter((m) => m.alertaGenerada).map((m) => m.insumo),
    };
  });
}

type LineaAtencion = { tratamientoId: number; piezaDental: string | null };
const claveLineas = (l: LineaAtencion[]) => l.map((t) => `${t.tratamientoId}:${t.piezaDental ?? ''}`).sort().join('|');

/** Datos de una atención para editarla (solo su odontólogo). */
export async function verParaEditar(atencionId: number, usuario: UsuarioSesion) {
  const a = await prisma.atencion.findUnique({
    where: { id: atencionId },
    include: {
      cita: { include: { paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, ficha: { select: { alergias: true } } } }, comprobantes: { where: { anuladoEn: null, tipo: 'servicio' } } } },
      tratamientos: { orderBy: { id: 'asc' }, include: { tratamiento: { select: { nombre: true } } } },
    },
  });
  if (!a || a.odontologoId !== usuario.odontologoId) throw new ErrorNegocio(403, 'ATENCION_NO_EDITABLE', MENSAJES.ATENCION_NO_EDITABLE);
  return {
    id: a.id,
    citaId: a.citaId,
    fecha: dateAFecha(a.cita.fecha),
    hora: dateAHora(a.cita.hora),
    motivo: a.cita.motivo,
    paciente: { id: a.cita.paciente.id, dni: a.cita.paciente.dni, nombres: a.cita.paciente.nombres, apellidos: a.cita.paciente.apellidos, alergias: a.cita.paciente.ficha?.alergias ?? null },
    diagnostico: a.diagnostico,
    observaciones: a.observaciones,
    tratamientos: a.tratamientos.map((t) => ({ tratamientoId: t.tratamientoId, piezaDental: t.piezaDental, nombre: t.tratamiento.nombre, precio: t.precioAplicado.toFixed(2) })),
    cobrada: a.cita.comprobantes.length > 0,
  };
}

/**
 * CU-44 Corregir atención («extend» de CU-10; RN-20). Editar una atención ya registrada (corregir diagnóstico, observaciones, tratamientos o piezas).
 * Solo el odontólogo que la registró, con motivo. Se guarda la versión anterior (el historial la muestra).
 * Si ya se cobró, los tratamientos no cambian (cambiarían el importe): primero se anula el comprobante.
 * Flujo alterno (no es «include» de CU-12): si cambian los tratamientos, el stock se corrige con la diferencia de insumos (salida o devolución) y
 * los tratamientos que se mantienen conservan su precio congelado; los nuevos toman el del tarifario.
 */
export async function editarAtencion(atencionId: number, usuario: UsuarioSesion, dto: EditarAtencionDTO, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const [fila] = await tx.$queryRaw<{ cita_id: number }[]>`SELECT cita_id FROM atenciones WHERE id = ${atencionId} FOR UPDATE`;
    if (!fila) throw new ErrorNegocio(403, 'ATENCION_NO_EDITABLE', MENSAJES.ATENCION_NO_EDITABLE);
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${fila.cita_id} FOR UPDATE`;
    const a = await tx.atencion.findUniqueOrThrow({
      where: { id: atencionId },
      include: {
        cita: { include: { comprobantes: { where: { anuladoEn: null, tipo: 'servicio' } } } },
        tratamientos: { include: { tratamiento: { include: { insumos: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (a.odontologoId !== usuario.odontologoId) throw new ErrorNegocio(403, 'ATENCION_NO_EDITABLE', MENSAJES.ATENCION_NO_EDITABLE);

    const nuevas: LineaAtencion[] = dto.tratamientos.map((t) => ({ tratamientoId: t.tratamientoId, piezaDental: t.piezaDental ?? null }));
    const cambianTratamientos = claveLineas(nuevas) !== claveLineas(a.tratamientos);
    const observaciones = dto.observaciones || null;
    if (!cambianTratamientos && dto.diagnostico === a.diagnostico && observaciones === a.observaciones) {
      throw new ErrorNegocio(422, 'ATENCION_SIN_CAMBIOS', MENSAJES.ATENCION_SIN_CAMBIOS);
    }
    const cobrada = a.cita.comprobantes.length > 0 || a.cita.estado === 'pagada';
    if (cambianTratamientos && cobrada) throw new ErrorNegocio(409, 'ATENCION_COBRADA', MENSAJES.ATENCION_COBRADA);

    // Versión anterior (lo que decía antes de corregir)
    await tx.atencionEdicion.create({
      data: {
        atencionId,
        usuarioId: usuario.id,
        motivo: dto.motivo,
        anterior: {
          diagnostico: a.diagnostico,
          observaciones: a.observaciones,
          tratamientos: a.tratamientos.map((t) => ({ nombre: t.tratamiento.nombre, piezaDental: t.piezaDental })),
        },
      },
    });

    const movimientos: ResultadoMovimiento[] = [];
    if (cambianTratamientos) {
      // RN-08: los tratamientos nuevos deben ser activos del tarifario (los que ya estaban se aceptan aunque se hayan desactivado)
      const previos = new Set(a.tratamientos.map((t) => t.tratamientoId));
      const ids = [...new Set(nuevas.map((t) => t.tratamientoId))];
      const tarifario = await tx.tratamiento.findMany({ where: { id: { in: ids } }, include: { insumos: true } });
      if (tarifario.length !== ids.length || tarifario.some((t) => !t.activo && !previos.has(t.id))) {
        throw new ErrorNegocio(422, 'TRATAMIENTO_NO_TARIFARIO', MENSAJES.TRATAMIENTO_NO_TARIFARIO);
      }
      const porId = new Map(tarifario.map((t) => [t.id, t]));
      // Precio congelado de las líneas que se mantienen (por tratamiento, en orden)
      const preciosPrevios = new Map<number, Prisma.Decimal[]>();
      for (const t of a.tratamientos) preciosPrevios.set(t.tratamientoId, [...(preciosPrevios.get(t.tratamientoId) ?? []), t.precioAplicado]);

      // Diferencia de insumos: nuevo consumo − consumo anterior
      const delta = new Map<number, Prisma.Decimal>();
      const sumar = (insumoId: number, c: Prisma.Decimal) => delta.set(insumoId, (delta.get(insumoId) ?? new Prisma.Decimal(0)).plus(c));
      for (const t of a.tratamientos) for (const i of t.tratamiento.insumos) sumar(i.insumoId, i.cantidad.neg());
      for (const t of nuevas) for (const i of porId.get(t.tratamientoId)!.insumos) sumar(i.insumoId, i.cantidad);

      await tx.atencionTratamiento.deleteMany({ where: { atencionId } });
      await tx.atencionTratamiento.createMany({
        data: nuevas.map((t) => ({
          atencionId,
          tratamientoId: t.tratamientoId,
          piezaDental: t.piezaDental,
          precioAplicado: preciosPrevios.get(t.tratamientoId)?.shift() ?? porId.get(t.tratamientoId)!.precio,
        })),
      });
      for (const [insumoId, cantidad] of [...delta].filter(([, c]) => !c.isZero()).sort((x, y) => x[0] - y[0])) {
        movimientos.push(
          await registrarMovimiento(tx, {
            insumoId,
            // más consumo → salida; menos consumo → devolución al stock (ajuste positivo)
            tipo: cantidad.isPositive() ? 'salida_tratamiento' : 'ajuste',
            cantidad: cantidad.abs(),
            usuarioId: usuario.id,
            motivo: `Corrección de la atención de la cita #${a.citaId}`,
            referencia: { tipo: 'atencion', id: atencionId },
          }),
        );
      }
    }

    await tx.atencion.update({ where: { id: atencionId }, data: { diagnostico: dto.diagnostico, observaciones } });
    const pacienteId = (await tx.cita.findUniqueOrThrow({ where: { id: a.citaId }, select: { pacienteId: true } })).pacienteId;
    await registrarAuditoria(tx, { usuarioId: usuario.id, accion: 'editar_atencion', pacienteId, detalle: `Atención de la cita #${a.citaId}: ${dto.motivo}`, ip });

    return { atencionId, citaId: a.citaId, tratamientosCambiados: cambianTratamientos, insumos: movimientos, alertas: movimientos.filter((m) => m.alertaGenerada).map((m) => m.insumo) };
  });
}
