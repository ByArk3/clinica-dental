import { MENSAJES, type PacienteDTO, type RegistroPacienteDTO } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { fechaADate, dateAFecha } from '../lib/fechas.js';
import { hashPassword } from './auth.service.js';

/** Datos de contacto: lo único que ve la recepcionista (RN-07). Sin ficha clínica. */
const CONTACTO = {
  id: true,
  dni: true,
  nombres: true,
  apellidos: true,
  fechaNacimiento: true,
  telefono: true,
  email: true,
  direccion: true,
  apoderado: true,
  inasistencias: true,
  restringido: true,
} as const;

type Contacto = { fechaNacimiento: Date } & Record<string, unknown>;
const formatear = <T extends Contacto>(p: T) => ({ ...p, fechaNacimiento: dateAFecha(p.fechaNacimiento) });

async function crearConFicha(tx: Tx, dto: PacienteDTO, usuarioId?: number) {
  // RN-05: todo paciente tiene ficha antes de su primera atención → se crea junto con el paciente
  return tx.paciente.create({
    data: {
      dni: dto.dni,
      nombres: dto.nombres,
      apellidos: dto.apellidos,
      fechaNacimiento: fechaADate(dto.fechaNacimiento),
      telefono: dto.telefono,
      email: dto.email?.toLowerCase(),
      direccion: dto.direccion,
      apoderado: dto.apoderado,
      usuarioId,
      ficha: { create: { alergias: dto.alergias, antecedentes: dto.antecedentes } },
    },
    select: CONTACTO,
  });
}

/** CU-03 Registrar paciente (recepcionista, presencial) */
export async function registrarPaciente(dto: PacienteDTO) {
  const existe = await prisma.paciente.findUnique({ where: { dni: dto.dni } });
  if (existe) throw new ErrorNegocio(409, 'DNI_DUPLICADO', MENSAJES.DNI_DUPLICADO);
  return formatear(await prisma.$transaction((tx) => crearConFicha(tx, dto)));
}

/**
 * CU-03 Registro web: el paciente crea su cuenta.
 * Si ya fue registrado en la clínica (mismo DNI, sin cuenta), se vincula la cuenta a ese paciente.
 */
export async function registrarCuentaPaciente(dto: RegistroPacienteDTO) {
  const email = dto.email.toLowerCase();
  if (await prisma.usuario.findUnique({ where: { email } })) {
    throw new ErrorNegocio(409, 'EMAIL_DUPLICADO', MENSAJES.EMAIL_DUPLICADO);
  }
  const existente = await prisma.paciente.findUnique({ where: { dni: dto.dni } });
  if (existente?.usuarioId) throw new ErrorNegocio(409, 'DNI_DUPLICADO', MENSAJES.DNI_DUPLICADO);

  const password = await hashPassword(dto.password);
  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: { nombres: `${dto.nombres} ${dto.apellidos}`, email, password, rol: 'paciente' },
    });
    const paciente = existente
      ? await tx.paciente.update({
          where: { id: existente.id },
          data: { usuarioId: usuario.id, email, telefono: dto.telefono },
          select: CONTACTO,
        })
      : await crearConFicha(tx, { ...dto, email }, usuario.id);
    return { usuario, paciente: formatear(paciente) };
  });
}

/** Buscar paciente por DNI (paso 1 de CU-06 presencial). */
export async function buscarPorDni(dni: string) {
  const p = await prisma.paciente.findUnique({ where: { dni }, select: CONTACTO });
  if (!p) throw new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);
  return formatear(p);
}

export async function obtenerContacto(id: number) {
  const p = await prisma.paciente.findUnique({ where: { id }, select: CONTACTO });
  if (!p) throw new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);
  return formatear(p);
}
