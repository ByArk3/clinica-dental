import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MENSAJES, type CitaDTO, type UsuarioSesion } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { ahoraLima, dateAFecha, dateAHora, fechaADate, horaADate } from '../lib/fechas.js';
import { bloquesDelHorario, horasOcupadas } from './disponibilidad.service.js';

const horarioTomado = () => new ErrorNegocio(409, 'HORARIO_NO_DISPONIBLE', MENSAJES.HORARIO_NO_DISPONIBLE);

/**
 * CU-06 Registrar cita (c_grabarCita).
 * Web: el paciente sale de la sesión. Presencial: la recepcionista envía pacienteId (buscado por DNI).
 */
export async function registrarCita(dto: CitaDTO, usuario: UsuarioSesion) {
  const canal = usuario.rol === 'paciente' ? 'web' : 'presencial';
  const pacienteId = canal === 'web' ? usuario.pacienteId : dto.pacienteId;
  // RN-01: toda cita tiene paciente, odontólogo, fecha y hora (los demás los exige el esquema Zod)
  if (!pacienteId) {
    throw new ErrorNegocio(422, 'VALIDACION', 'Seleccione un paciente', { pacienteId: 'Seleccione un paciente' });
  }

  const ahora = ahoraLima();
  if (dto.fecha < ahora.fecha || (dto.fecha === ahora.fecha && dto.hora <= ahora.hora)) {
    throw new ErrorNegocio(422, 'HORA_PASADA', MENSAJES.HORA_PASADA);
  }

  try {
    const cita = await prisma.$transaction(async (tx) => {
      const paciente = await tx.paciente.findUnique({ where: { id: pacienteId } });
      if (!paciente) throw new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);

      // RN-02: bloqueo de la fila del odontólogo → las reservas web y presenciales simultáneas
      // para el mismo odontólogo se serializan. El índice único parcial es la última barrera.
      const [odontologo] = await tx.$queryRaw<{ id: number; activo: boolean }[]>`
        SELECT id, activo FROM odontologos WHERE id = ${dto.odontologoId} FOR UPDATE`;
      if (!odontologo?.activo) {
        throw new ErrorNegocio(422, 'ODONTOLOGO_NO_DISPONIBLE', MENSAJES.ODONTOLOGO_NO_DISPONIBLE);
      }

      // RN-03: solo dentro del horario de atención
      const bloques = await bloquesDelHorario(tx, dto.odontologoId, dto.fecha);
      if (bloques.length === 0) throw new ErrorNegocio(422, 'CLINICA_NO_ATIENDE', MENSAJES.CLINICA_NO_ATIENDE);
      if (!bloques.includes(dto.hora)) throw new ErrorNegocio(422, 'FUERA_DE_HORARIO', MENSAJES.FUERA_DE_HORARIO);

      // 8.1: horario tomado por otro mientras se elegía
      if ((await horasOcupadas(tx, dto.odontologoId, dto.fecha)).has(dto.hora)) throw horarioTomado();

      // 8.2 / RN-12: paciente con 3+ inasistencias → pendiente de adelanto
      const estado = paciente.restringido ? 'pendiente_adelanto' : 'pendiente_confirmacion';

      return tx.cita.create({
        data: {
          pacienteId,
          odontologoId: dto.odontologoId,
          fecha: fechaADate(dto.fecha),
          hora: horaADate(dto.hora),
          motivo: dto.motivo,
          canal,
          estado,
          tokenConfirmacion: crypto.randomBytes(24).toString('hex'),
          creadoPorId: usuario.id,
        },
        include: { odontologo: { include: { usuario: { select: { nombres: true } } } } },
      });
    });

    return {
      cita: formatearCita(cita),
      aviso: cita.estado === 'pendiente_adelanto' ? MENSAJES.ADELANTO_OBLIGATORIO : undefined,
    };
  } catch (e) {
    // Carrera que pasó el bloqueo (p. ej. otra conexión): el índice parcial rechaza el duplicado
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw horarioTomado();
    throw e;
  }
}

/** Citas del paciente en sesión (vista web). */
export async function citasDelPaciente(pacienteId: number) {
  const citas = await prisma.cita.findMany({
    where: { pacienteId },
    orderBy: [{ fecha: 'desc' }, { hora: 'desc' }],
    include: { odontologo: { include: { usuario: { select: { nombres: true } } } } },
  });
  return citas.map(formatearCita);
}

type CitaConOdontologo = Prisma.CitaGetPayload<{
  include: { odontologo: { include: { usuario: { select: { nombres: true } } } } };
}>;

// No se expone token_confirmacion: solo viaja en el correo de recordatorio (RNF08)
function formatearCita(c: CitaConOdontologo) {
  return {
    id: c.id,
    pacienteId: c.pacienteId,
    odontologoId: c.odontologoId,
    odontologo: c.odontologo.usuario.nombres,
    fecha: dateAFecha(c.fecha),
    hora: dateAHora(c.hora),
    motivo: c.motivo,
    canal: c.canal,
    estado: c.estado,
  };
}
