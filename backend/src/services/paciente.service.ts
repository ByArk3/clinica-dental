import { MENSAJES, normalizar, puntaje, type EditarPacienteDTO, type PacienteDTO, type PacienteSinDniDTO, type RegistroPacienteDTO } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { fechaADate, dateAFecha, ahoraLima } from '../lib/fechas.js';
import { edadEn } from './precio.service.js';
import { registrar as auditar } from './auditoria.service.js';
import { consultarDni } from './reniec.service.js';
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
  sexo: true,
  usuarioId: true,
  inasistencias: true,
  restringido: true,
  saldoFavor: true,
} as const;

type Contacto = { fechaNacimiento: Date; saldoFavor: { toFixed: (n: number) => string }; usuarioId?: number | null } & Record<string, unknown>;
// tieneCuenta: el paciente inicia sesión en la web con su correo (en «Editar datos» el correo es obligatorio)
const formatear = <T extends Contacto>(p: T) => {
  const { usuarioId, ...resto } = p;
  return { ...resto, tieneCuenta: !!usuarioId, fechaNacimiento: dateAFecha(p.fechaNacimiento), saldoFavor: p.saldoFavor.toFixed(2) };
};

async function crearConFicha(tx: Tx, dto: Omit<PacienteDTO, 'dni'> & { dni?: string }, usuarioId?: number) {
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
      sexo: dto.sexo,
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

/** CU-04 Actualizar datos de contacto (paciente: los suyos; recepcionista: de cualquier paciente). */
export async function actualizarContacto(id: number, dto: import('@clinica/shared').ContactoDTO) {
  if (!(await prisma.paciente.findUnique({ where: { id } }))) {
    throw new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);
  }
  const p = await prisma.paciente.update({
    where: { id },
    data: {
      telefono: dto.telefono,
      email: dto.email?.toLowerCase() ?? null,
      direccion: dto.direccion || null,
      apoderado: dto.apoderado || null,
    },
    select: CONTACTO,
  });
  return formatear(p);
}

// ===================== Paciente sin DNI, búsqueda por nombre y correcciones (CU-58) =====================

const noEncontrado = () => new ErrorNegocio(404, 'PACIENTE_NO_ENCONTRADO', MENSAJES.PACIENTE_NO_ENCONTRADO);
/** Solo los 3 últimos dígitos del celular: suficiente para confirmar con el paciente, sin exponer el número. */
const celularOculto = (t: string) => `***-***-${t.slice(-3)}`;

/**
 * Búsqueda por nombre para la recepcionista: solo datos para distinguir homónimos (edad, celular parcial, DNI),
 * nada clínico (RN-07). Tolera tildes y pequeños errores de escritura. Si se da la fecha de nacimiento,
 * los que coinciden en ella van primero (sirve para avisar de duplicados al registrar sin DNI).
 */
export async function buscarPorNombre(f: { apellidos: string; nombres?: string; fechaNacimiento?: string }) {
  const inicial = normalizar(f.apellidos).slice(0, 1);
  const candidatos = await prisma.paciente.findMany({
    select: { id: true, dni: true, nombres: true, apellidos: true, fechaNacimiento: true, telefono: true },
  });
  const hoy = ahoraLima().fecha;
  const lista = candidatos
    .map((p) => {
      const pa = puntaje(p.apellidos, f.apellidos);
      const pn = f.nombres ? puntaje(p.nombres, f.nombres) : 0;
      if (pa === null || pn === null) return null;
      const mismaFecha = !!f.fechaNacimiento && dateAFecha(p.fechaNacimiento) === f.fechaNacimiento;
      return { p, orden: (mismaFecha ? -10 : 0) + pa + pn + (normalizar(p.apellidos).startsWith(inicial) ? 0 : 1) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.orden - b.orden || a.p.apellidos.localeCompare(b.p.apellidos, 'es') || a.p.nombres.localeCompare(b.p.nombres, 'es'))
    .slice(0, 20)
    .map(({ p }) => p);
  const proximas = await (await import('./cita.service.js')).resumenProximas(lista.map((p) => p.id));
  return lista.map((p) => ({
      id: p.id,
      dni: p.dni,
      nombres: p.nombres,
      apellidos: p.apellidos,
      fechaNacimiento: dateAFecha(p.fechaNacimiento),
      edad: edadEn(p.fechaNacimiento, hoy),
      celular: celularOculto(p.telefono),
      proximas: proximas.get(p.id)?.proximas ?? 0,
      siguienteCita: proximas.get(p.id)?.siguiente ?? null,
    }));
}

/** Registro presencial sin DNI a la mano: queda «DNI pendiente» (dni = null) y se completa después. */
export async function registrarSinDni(dto: PacienteSinDniDTO) {
  return formatear(await prisma.$transaction((tx) => crearConFicha(tx, dto)));
}

const IDENTIDAD = ['nombres', 'apellidos', 'fechaNacimiento', 'sexo'] as const;
const ETIQUETA: Record<string, string> = {
  nombres: 'Nombres', apellidos: 'Apellidos', fechaNacimiento: 'Fecha de nacimiento', sexo: 'Sexo',
  telefono: 'Celular', email: 'Correo', direccion: 'Dirección', apoderado: 'Apoderado',
};

/**
 * CU-58 Corregir datos del paciente (recepcionista o administrador).
 * Solo guarda lo que cambió. Si cambia un dato de identidad pide motivo y deja el antes/después en la auditoría (RN-22).
 */
export async function editarPaciente(id: number, dto: EditarPacienteDTO, usuarioId: number, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const actual = await tx.paciente.findUnique({ where: { id } });
    if (!actual) throw noEncontrado();
    const antes: Record<string, string | null> = {
      nombres: actual.nombres, apellidos: actual.apellidos, fechaNacimiento: dateAFecha(actual.fechaNacimiento), sexo: actual.sexo,
      telefono: actual.telefono, email: actual.email, direccion: actual.direccion, apoderado: actual.apoderado,
    };
    const despues: Record<string, string | null> = {
      nombres: dto.nombres, apellidos: dto.apellidos, fechaNacimiento: dto.fechaNacimiento, sexo: dto.sexo ?? null,
      telefono: dto.telefono, email: dto.email?.toLowerCase() || null, direccion: dto.direccion || null, apoderado: dto.apoderado || null,
    };
    const cambios = Object.keys(despues).filter((k) => (antes[k] ?? null) !== (despues[k] ?? null));
    if (cambios.length === 0) throw new ErrorNegocio(422, 'SIN_CAMBIOS', MENSAJES.SIN_CAMBIOS);
    // Con cuenta web el correo es su usuario: es obligatorio y se cambia también en la cuenta (sin repetir el de otra)
    if (actual.usuarioId && !despues.email) {
      throw new ErrorNegocio(422, 'VALIDACION', 'El paciente tiene cuenta web: el correo es obligatorio', { email: 'El paciente tiene cuenta web: el correo es obligatorio' });
    }
    if (actual.usuarioId && cambios.includes('email') && (await tx.usuario.findFirst({ where: { email: despues.email!, id: { not: actual.usuarioId } } }))) {
      throw new ErrorNegocio(409, 'EMAIL_DUPLICADO', MENSAJES.EMAIL_DUPLICADO, { email: MENSAJES.EMAIL_DUPLICADO });
    }
    const identidad = cambios.filter((k) => (IDENTIDAD as readonly string[]).includes(k));
    if (identidad.length > 0 && (dto.motivo ?? '').trim().length < 5) {
      throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', MENSAJES.MOTIVO_CORRECCION, { motivo: MENSAJES.MOTIVO_CORRECCION });
    }
    const p = await tx.paciente.update({
      where: { id },
      data: {
        nombres: dto.nombres, apellidos: dto.apellidos, fechaNacimiento: fechaADate(dto.fechaNacimiento), sexo: dto.sexo ?? null,
        telefono: dto.telefono, email: despues.email, direccion: despues.direccion, apoderado: despues.apoderado,
      },
      select: CONTACTO,
    });
    if (actual.usuarioId && cambios.includes('email')) await tx.usuario.update({ where: { id: actual.usuarioId }, data: { email: despues.email! } });
    if (identidad.length > 0) {
      const detalle = identidad.map((k) => `${ETIQUETA[k]}: «${antes[k] ?? '—'}» → «${despues[k] ?? '—'}»`).join('; ');
      await auditar(tx, { usuarioId, accion: 'corregir_paciente', pacienteId: id, detalle: `${detalle}. Motivo: ${dto.motivo!.trim()}`, ip });
    }
    return { paciente: formatear(p), cambios: cambios.map((k) => ETIQUETA[k]) };
  });
}

/** Compara nombres sin tildes, mayúsculas ni orden de palabras («JUANA ROSALES MENDOZA» = «Juana / Rosales Mendoza»). */
const mismasPalabras = (a: string, b: string) => normalizar(a).split(/\s+/).sort().join(' ') === normalizar(b).split(/\s+/).sort().join(' ');

/**
 * Completar DNI (recepcionista, si estaba pendiente) o cambiarlo (solo Administrador, con motivo).
 * Verifica que no sea de otro paciente y, si RENIEC responde, que los nombres coincidan (o que se confirme).
 */
export async function guardarDni(id: number, dto: { dni: string; motivo?: string; confirmar?: boolean }, usuario: { id: number; rol: string }, ip?: string) {
  const actual = await prisma.paciente.findUnique({ where: { id } });
  if (!actual) throw noEncontrado();
  if (actual.dni === dto.dni) throw new ErrorNegocio(422, 'SIN_CAMBIOS', MENSAJES.SIN_CAMBIOS);
  if (actual.dni && usuario.rol !== 'administrador') throw new ErrorNegocio(403, 'DNI_SOLO_ADMIN', MENSAJES.DNI_SOLO_ADMIN);
  if (actual.dni && (dto.motivo ?? '').trim().length < 5) {
    throw new ErrorNegocio(422, 'MOTIVO_REQUERIDO', 'Indique el motivo del cambio de DNI', { motivo: 'Indique el motivo del cambio de DNI' });
  }
  const otro = await prisma.paciente.findUnique({ where: { dni: dto.dni }, select: { nombres: true, apellidos: true } });
  if (otro) {
    throw new ErrorNegocio(409, 'DNI_DUPLICADO', `${MENSAJES.DNI_DUPLICADO}: ${otro.nombres} ${otro.apellidos}`, { dni: MENSAJES.DNI_DUPLICADO });
  }
  if (!dto.confirmar) {
    const r = await consultarDni(dto.dni);
    if (r.encontrado && !mismasPalabras(`${r.nombres} ${r.apellidos}`, `${actual.nombres} ${actual.apellidos}`)) {
      throw new ErrorNegocio(409, 'DNI_RENIEC_NO_COINCIDE', `${MENSAJES.DNI_RENIEC_NO_COINCIDE}: RENIEC indica «${r.nombres} ${r.apellidos}»`, {
        reniec: `${r.nombres} ${r.apellidos}`,
      });
    }
  }
  return prisma.$transaction(async (tx) => {
    const p = await tx.paciente.update({ where: { id }, data: { dni: dto.dni }, select: CONTACTO });
    await auditar(tx, {
      usuarioId: usuario.id,
      accion: 'cambiar_dni',
      pacienteId: id,
      detalle: actual.dni ? `DNI: «${actual.dni}» → «${dto.dni}». Motivo: ${dto.motivo!.trim()}` : `Completó el DNI pendiente: ${dto.dni}${dto.confirmar ? ' (confirmado aunque RENIEC no coincidía)' : ''}`,
      ip,
    });
    return formatear(p);
  });
}

/** Cantidad de pacientes con DNI pendiente (Panel del Administrador). */
export const contarSinDni = () => prisma.paciente.count({ where: { dni: null } });

/** Lista de pacientes con DNI pendiente (para completarlos). */
export async function listarSinDni() {
  const hoy = ahoraLima().fecha;
  const lista = await prisma.paciente.findMany({ where: { dni: null }, orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }], select: CONTACTO });
  return lista.map((p) => ({ ...formatear(p), edad: edadEn(p.fechaNacimiento, hoy) }));
}
