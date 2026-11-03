// CU-10 Consultar historial clínico. RN-07: solo Odontólogo y Administrador (lo exige la ruta).
import { MENSAJES } from '@clinica/shared';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { dateAFecha, dateAHora } from '../lib/fechas.js';

const noEncontrado = () => new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);

/** Buscar por DNI (8 dígitos) o por nombre/apellidos (todas las palabras deben coincidir). */
export async function buscarPacientes(q: string) {
  const texto = q.trim();
  const where = /^\d{8}$/.test(texto)
    ? { dni: texto }
    : {
        AND: texto.split(/\s+/).map((palabra) => ({
          OR: [
            { nombres: { contains: palabra, mode: 'insensitive' as const } },
            { apellidos: { contains: palabra, mode: 'insensitive' as const } },
            { dni: { startsWith: palabra } },
          ],
        })),
      };
  const pacientes = await prisma.paciente.findMany({
    where,
    take: 20,
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    select: { id: true, dni: true, nombres: true, apellidos: true, fechaNacimiento: true, _count: { select: { citas: { where: { atencion: { isNot: null } } } } } },
  });
  if (pacientes.length === 0) throw noEncontrado(); // 2.1
  return pacientes.map((p) => ({
    id: p.id,
    dni: p.dni,
    nombres: p.nombres,
    apellidos: p.apellidos,
    fechaNacimiento: dateAFecha(p.fechaNacimiento),
    atenciones: p._count.citas,
  }));
}

/** Ficha y atenciones del paciente, de la más reciente a la más antigua. */
export async function historial(pacienteId: number) {
  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    include: {
      ficha: {
        include: {
          atenciones: {
            include: {
              cita: { select: { fecha: true, hora: true, motivo: true } },
              odontologo: { include: { usuario: { select: { nombres: true } } } },
              tratamientos: { include: { tratamiento: { select: { nombre: true } } }, orderBy: { id: 'asc' } },
            },
          },
        },
      },
    },
  });
  if (!paciente) throw noEncontrado();
  if (!paciente.ficha) throw new ErrorNegocio(500, 'SIN_FICHA', 'El paciente no tiene ficha (RN-05)');

  const atenciones = paciente.ficha.atenciones
    .map((a) => ({
      id: a.id,
      fecha: dateAFecha(a.cita.fecha),
      hora: dateAHora(a.cita.hora),
      motivo: a.cita.motivo,
      odontologo: a.odontologo.usuario.nombres,
      diagnostico: a.diagnostico,
      observaciones: a.observaciones,
      tratamientos: a.tratamientos.map((t) => ({ nombre: t.tratamiento.nombre, piezaDental: t.piezaDental, precio: t.precioAplicado.toFixed(2) })),
    }))
    .sort((x, y) => `${y.fecha}${y.hora}`.localeCompare(`${x.fecha}${x.hora}`) || y.id - x.id);

  return {
    paciente: {
      id: paciente.id,
      dni: paciente.dni,
      nombres: paciente.nombres,
      apellidos: paciente.apellidos,
      fechaNacimiento: dateAFecha(paciente.fechaNacimiento),
      telefono: paciente.telefono,
      apoderado: paciente.apoderado,
      inasistencias: paciente.inasistencias,
    },
    ficha: { alergias: paciente.ficha.alergias, antecedentes: paciente.ficha.antecedentes, notas: paciente.ficha.notas },
    atenciones,
    mensaje: atenciones.length === 0 ? MENSAJES.SIN_ATENCIONES : undefined, // 5.1
  };
}
