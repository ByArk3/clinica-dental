// CU-11 Registrar tratamiento (atención) — Odontólogo. RN-06, RN-08, RN-09.
import { Prisma } from '@prisma/client';
import { MENSAJES, motivoAMostrar, type AtencionDTO, type EditarAtencionDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
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
      tratamientoPrevisto: { select: { nombre: true } },
    },
  });
  const hoy = ahoraLima().fecha;
  return citas.map((c) => ({
    id: c.id,
    fecha: dateAFecha(c.fecha),
    hora: dateAHora(c.hora),
    motivo: motivoAMostrar(c.motivo, c.tratamientoPrevisto?.nombre),
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

    // 5.1: varios tratamientos → se descuentan los insumos de cada uno (sumados por insumo).
    // Pendiente 32: si el odontólogo ajustó los insumos, se descuenta lo que indicó.
    const consumo = dto.insumos ? await consumoAjustado(tx, dto.insumos) : consumoDelTarifario(dto.tratamientos.map((t) => porId.get(t.tratamientoId)!));
    const motivo = `Atención de la cita #${citaId}${dto.insumos ? ` — insumos ajustados por el odontólogo${dto.motivoInsumos ? `: ${dto.motivoInsumos}` : ''}` : ''}`;
    const movimientos: ResultadoMovimiento[] = [];
    for (const [insumoId, cantidad] of [...consumo].sort((a, b) => a[0] - b[0])) {
      movimientos.push(
        await registrarMovimiento(tx, {
          insumoId,
          tipo: 'salida_tratamiento',
          cantidad,
          usuarioId: usuario.id,
          motivo,
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
type ConInsumos = { insumos: { insumoId: number; cantidad: Prisma.Decimal }[] };

/** Lo que consumen los tratamientos según el tarifario, sumado por insumo. */
function consumoDelTarifario(tratamientos: ConInsumos[]) {
  const consumo = new Map<number, Prisma.Decimal>();
  for (const t of tratamientos) for (const i of t.insumos) consumo.set(i.insumoId, (consumo.get(i.insumoId) ?? new Prisma.Decimal(0)).plus(i.cantidad));
  return consumo;
}

/** Insumos indicados por el odontólogo (pendiente 32): deben existir y estar activos; se suman si se repiten. */
async function consumoAjustado(tx: Tx, lista: { insumoId: number; cantidad: number }[], yaUsados = new Set<number>()) {
  const consumo = new Map<number, Prisma.Decimal>();
  for (const i of lista) consumo.set(i.insumoId, (consumo.get(i.insumoId) ?? new Prisma.Decimal(0)).plus(i.cantidad));
  const ids = [...consumo.keys()];
  const existentes = await tx.insumo.findMany({ where: { id: { in: ids } } });
  if (existentes.length !== ids.length) throw new ErrorNegocio(404, 'INSUMO_NO_ENCONTRADO', MENSAJES.INSUMO_NO_ENCONTRADO);
  // un insumo desactivado solo se acepta si ya se había usado en esta atención (corrección)
  if (existentes.some((x) => !x.activo && !yaUsados.has(x.id))) throw new ErrorNegocio(422, 'INSUMO_INACTIVO', MENSAJES.INSUMO_INACTIVO);
  return consumo;
}

/** Lo que realmente se descontó para una atención (según el kárdex): salidas menos devoluciones. */
async function consumoReal(tx: Tx, atencionId: number) {
  const movs = await tx.movimientoKardex.groupBy({ by: ['insumoId'], where: { referenciaTipo: 'atencion', referenciaId: atencionId }, _sum: { cantidad: true } });
  return new Map(movs.map((m) => [m.insumoId, (m._sum.cantidad ?? new Prisma.Decimal(0)).neg()]));
}
const claveLineas = (l: LineaAtencion[]) => l.map((t) => `${t.tratamientoId}:${t.piezaDental ?? ''}`).sort().join('|');

/** Datos de una atención para editarla (solo su odontólogo). */
export async function verParaEditar(atencionId: number, usuario: UsuarioSesion) {
  const a = await prisma.atencion.findUnique({
    where: { id: atencionId },
    include: {
      cita: { include: { tratamientoPrevisto: { select: { nombre: true } }, paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, ficha: { select: { alergias: true } } } }, comprobantes: { where: { anuladoEn: null, tipo: 'servicio' } } } },
      tratamientos: { orderBy: { id: 'asc' }, include: { tratamiento: { select: { nombre: true } } } },
    },
  });
  if (!a || a.odontologoId !== usuario.odontologoId) throw new ErrorNegocio(403, 'ATENCION_NO_EDITABLE', MENSAJES.ATENCION_NO_EDITABLE);
  return {
    id: a.id,
    citaId: a.citaId,
    fecha: dateAFecha(a.cita.fecha),
    hora: dateAHora(a.cita.hora),
    motivo: motivoAMostrar(a.cita.motivo, a.cita.tratamientoPrevisto?.nombre),
    paciente: { id: a.cita.paciente.id, dni: a.cita.paciente.dni, nombres: a.cita.paciente.nombres, apellidos: a.cita.paciente.apellidos, alergias: a.cita.paciente.ficha?.alergias ?? null },
    diagnostico: a.diagnostico,
    observaciones: a.observaciones,
    tratamientos: a.tratamientos.map((t) => ({ tratamientoId: t.tratamientoId, piezaDental: t.piezaDental, nombre: t.tratamiento.nombre, precio: t.precioAplicado.toFixed(2) })),
    // Insumos que realmente se descontaron (pueden diferir del tarifario si el odontólogo los ajustó)
    insumos: [...(await consumoReal(prisma as unknown as Tx, a.id))].filter(([, c]) => c.gt(0)).map(([insumoId, c]) => ({ insumoId, cantidad: c.toFixed(2) })),
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
    // Pendiente 32: insumos indicados por el odontólogo → se compara con lo que realmente se descontó
    const previo = cambianTratamientos || dto.insumos ? await consumoReal(tx, atencionId) : new Map<number, Prisma.Decimal>();
    const ajusteInsumos = dto.insumos ? await consumoAjustado(tx, dto.insumos, new Set(previo.keys())) : null;
    const cambianInsumos = !!ajusteInsumos && [...new Set([...previo.keys(), ...ajusteInsumos.keys()])].some((id) => !(previo.get(id) ?? new Prisma.Decimal(0)).equals(ajusteInsumos.get(id) ?? 0));
    if (!cambianTratamientos && !cambianInsumos && dto.diagnostico === a.diagnostico && observaciones === a.observaciones) {
      throw new ErrorNegocio(422, 'ATENCION_SIN_CAMBIOS', MENSAJES.ATENCION_SIN_CAMBIOS);
    }
    const cobrada = a.cita.comprobantes.length > 0 || a.cita.estado === 'pagada';
    if ((cambianTratamientos || cambianInsumos) && cobrada) throw new ErrorNegocio(409, 'ATENCION_COBRADA', MENSAJES.ATENCION_COBRADA);

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
    let nuevoConsumo: Map<number, Prisma.Decimal> | null = ajusteInsumos;
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

      nuevoConsumo ??= consumoDelTarifario(nuevas.map((t) => porId.get(t.tratamientoId)!));

      await tx.atencionTratamiento.deleteMany({ where: { atencionId } });
      await tx.atencionTratamiento.createMany({
        data: nuevas.map((t) => ({
          atencionId,
          tratamientoId: t.tratamientoId,
          piezaDental: t.piezaDental,
          precioAplicado: preciosPrevios.get(t.tratamientoId)?.shift() ?? porId.get(t.tratamientoId)!.precio,
        })),
      });
    }
    if (nuevoConsumo) {
      // Diferencia de insumos: nuevo consumo − lo que realmente se descontó antes
      const delta = new Map<number, Prisma.Decimal>();
      for (const [id, c] of previo) delta.set(id, c.neg());
      for (const [id, c] of nuevoConsumo) delta.set(id, (delta.get(id) ?? new Prisma.Decimal(0)).plus(c));
      const motivo = `Corrección de la atención de la cita #${a.citaId}${dto.insumos && dto.motivoInsumos ? ` — ${dto.motivoInsumos}` : ''}`;
      for (const [insumoId, cantidad] of [...delta].filter(([, c]) => !c.isZero()).sort((x, y) => x[0] - y[0])) {
        movimientos.push(
          await registrarMovimiento(tx, {
            insumoId,
            // más consumo → salida; menos consumo → devolución al stock (ajuste positivo)
            tipo: cantidad.isPositive() ? 'salida_tratamiento' : 'ajuste',
            cantidad: cantidad.abs(),
            usuarioId: usuario.id,
            motivo,
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
