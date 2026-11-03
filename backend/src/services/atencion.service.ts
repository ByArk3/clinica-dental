// CU-11 Registrar tratamiento (atención) — Odontólogo. RN-06, RN-08, RN-09.
import { Prisma } from '@prisma/client';
import { MENSAJES, type AtencionDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { ahoraLima, dateAFecha, dateAHora, fechaADate } from '../lib/fechas.js';
import { registrarMovimiento, type ResultadoMovimiento } from './stock.service.js';

const noDisponible = () => new ErrorNegocio(409, 'CITA_NO_ATENCION', MENSAJES.CITA_NO_ATENCION);

/** CU-11 paso 1: «Mis citas del día» del odontólogo en sesión (confirmadas por atender y ya atendidas). */
export async function citasDelOdontologo(odontologoId: number, fecha: string) {
  const citas = await prisma.cita.findMany({
    where: { odontologoId, fecha: fechaADate(fecha), estado: { in: ['confirmada', 'atendida', 'pagada'] } },
    orderBy: { hora: 'asc' },
    include: {
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true, fechaNacimiento: true, ficha: { select: { alergias: true } } } },
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
