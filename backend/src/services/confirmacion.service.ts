import { MENSAJES, type CitaConfirmacion } from '@clinica/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, dateAHora } from '../lib/fechas.js';
import { horasParaCita } from './cita.service.js';

type CitaToken = Prisma.CitaGetPayload<{
  include: { paciente: { select: { nombres: true } }; odontologo: { include: { usuario: { select: { nombres: true } } } } };
}>;

/** Qué puede hacer el paciente con el enlace según el estado y el plazo de 24 h (RN-04). */
function evaluar(c: CitaToken): { puedeResponder: boolean; mensaje?: string; codigo?: string; status?: number } {
  const horas = horasParaCita(c.fecha, c.hora);
  if (c.estado === 'cancelada') return { puedeResponder: false, mensaje: MENSAJES.CITA_YA_CANCELADA, codigo: 'CITA_YA_CANCELADA', status: 409 };
  // 2.2: enlace abierto fuera de plazo (o la cita ya fue liberada por la tarea programada)
  if (c.estado === 'liberada' || (c.estado === 'pendiente_confirmacion' && horas < 24)) {
    return { puedeResponder: false, mensaje: MENSAJES.PLAZO_VENCIDO, codigo: 'PLAZO_VENCIDO', status: 422 };
  }
  if (c.estado === 'confirmada' && horas < 24) {
    return { puedeResponder: false, mensaje: MENSAJES.LIMITE_24H, codigo: 'LIMITE_24H', status: 422 };
  }
  if (c.estado === 'pendiente_confirmacion' || c.estado === 'confirmada') return { puedeResponder: true };
  return { puedeResponder: false, mensaje: MENSAJES.CITA_NO_MODIFICABLE, codigo: 'CITA_NO_MODIFICABLE', status: 409 };
}

const INCLUIR = {
  paciente: { select: { nombres: true } },
  odontologo: { include: { usuario: { select: { nombres: true } } } },
} as const;

async function buscar(token: string) {
  const cita = await prisma.cita.findUnique({ where: { tokenConfirmacion: token }, include: INCLUIR });
  if (!cita) throw new ErrorNegocio(404, 'ENLACE_CITA_INVALIDO', MENSAJES.ENLACE_CITA_INVALIDO);
  return cita;
}

// Solo lo mínimo: el enlace no requiere sesión, así que no se muestran datos personales ni clínicos (RNF08)
function vista(c: CitaToken): CitaConfirmacion {
  const { puedeResponder, mensaje } = evaluar(c);
  return {
    paciente: c.paciente.nombres,
    odontologo: c.odontologo.usuario.nombres,
    fecha: dateAFecha(c.fecha),
    hora: dateAHora(c.hora),
    estado: c.estado,
    puedeResponder,
    mensaje,
  };
}

/** CU-08 paso 2: el paciente abre el enlace y ve fecha, hora y odontólogo. */
export async function obtenerPorToken(token: string) {
  return vista(await buscar(token));
}

/** CU-08: Confirmar → «Confirmada». 4.1: Cancelar → «Cancelada» (CU-07) y el horario queda libre. */
export async function responder(token: string, accion: 'confirmar' | 'cancelar') {
  const actual = await buscar(token);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM citas WHERE id = ${actual.id} FOR UPDATE`;
    const cita = await tx.cita.findUniqueOrThrow({ where: { id: actual.id }, include: INCLUIR });
    const r = evaluar(cita);
    if (!r.puedeResponder) throw new ErrorNegocio(r.status!, r.codigo!, r.mensaje!);
    const actualizada = await tx.cita.update({
      where: { id: cita.id },
      data: { estado: accion === 'confirmar' ? 'confirmada' : 'cancelada' },
      include: INCLUIR,
    });
    return vista(actualizada);
  });
}
