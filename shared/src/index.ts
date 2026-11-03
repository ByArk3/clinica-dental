// Tipos y esquemas compartidos entre backend y frontend (mismas reglas en formulario y API).
import { z } from 'zod';

export const ROLES = ['paciente', 'recepcionista', 'odontologo', 'administrador'] as const;
export type Rol = (typeof ROLES)[number];

export const ESTADOS_CITA = [
  'pendiente_confirmacion',
  'pendiente_adelanto',
  'confirmada',
  'atendida',
  'pagada',
  'cancelada',
  'liberada',
  'inasistencia',
] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number];

export const ETIQUETA_ESTADO_CITA: Record<EstadoCita, string> = {
  pendiente_confirmacion: 'Pendiente de confirmación',
  pendiente_adelanto: 'Pendiente de adelanto',
  confirmada: 'Confirmada',
  atendida: 'Atendida',
  pagada: 'Pagada',
  cancelada: 'Cancelada',
  liberada: 'Liberada',
  inasistencia: 'Inasistencia',
};

export const CANALES = ['web', 'presencial'] as const;
export type Canal = (typeof CANALES)[number];

/** Mensajes exactos de la especificación (sección 9 del brief). */
export const MENSAJES = {
  HORARIO_NO_DISPONIBLE: 'El horario ya no está disponible',
  CLINICA_NO_ATIENDE: 'La clínica no atiende ese día',
  SIN_HORARIOS: 'No hay horarios disponibles para esa fecha',
  FUERA_DE_HORARIO: 'La hora elegida está fuera del horario de atención',
  HORA_PASADA: 'No se puede reservar en una fecha u hora pasada',
  PACIENTE_NO_ENCONTRADO: 'Paciente no encontrado',
  DNI_DUPLICADO: 'Ya existe un paciente registrado con ese DNI',
  EMAIL_DUPLICADO: 'Ya existe una cuenta con ese correo',
  CREDENCIALES_INVALIDAS: 'Correo o contraseña incorrectos',
  SIN_PERMISO: 'No tiene permiso para realizar esta acción',
  NO_AUTENTICADO: 'Su sesión expiró; inicie sesión nuevamente',
  ADELANTO_OBLIGATORIO:
    'El paciente tiene 3 o más inasistencias: la cita queda pendiente de adelanto hasta que se pague en caja',
  ENLACE_INVALIDO: 'El enlace de recuperación no es válido o ya venció',
  ODONTOLOGO_NO_DISPONIBLE: 'El odontólogo no está disponible',
  // CU-07
  CITA_NO_ENCONTRADA: 'Cita no encontrada',
  CITA_NO_MODIFICABLE: 'La cita ya no se puede reprogramar ni cancelar',
  LIMITE_24H: 'Solo puede reprogramar o cancelar hasta 24 horas antes; comuníquese con la clínica',
  // CU-08
  ENLACE_CITA_INVALIDO: 'El enlace no es válido',
  PLAZO_VENCIDO: 'El plazo de confirmación venció; comuníquese con la clínica',
  CITA_YA_CANCELADA: 'La cita ya fue cancelada',
  // CU-09
  INASISTENCIA_SOLO_CONFIRMADA: 'Solo se puede registrar inasistencia en una cita confirmada',
  HORA_NO_PASADA: 'La hora de la cita aún no pasó',
  PACIENTE_RESTRINGIDO:
    'El paciente llegó a 3 inasistencias: desde ahora debe pagar un adelanto para reservar (RN-12)',
  // Iteración 2: tarifario e insumos
  TRATAMIENTO_NO_ENCONTRADO: 'Tratamiento no encontrado',
  TRATAMIENTO_DUPLICADO: 'Ya existe un tratamiento con ese nombre',
  INSUMO_NO_ENCONTRADO: 'Insumo no encontrado',
  INSUMO_DUPLICADO: 'Ya existe un insumo con ese nombre',
  INSUMO_INACTIVO: 'Uno de los insumos está desactivado',
  INSUMO_EN_USO: 'No se puede desactivar: lo usa un tratamiento activo',
  // CU-10
  SIN_PERMISO_HISTORIAL: 'No tiene permiso para ver el historial clínico',
  SIN_ATENCIONES: 'El paciente no tiene atenciones registradas',
  // CU-11
  CITA_NO_ATENCION: 'La cita no está disponible para atención',
  TRATAMIENTO_NO_TARIFARIO: 'El tratamiento no está en el tarifario vigente',
} as const;

/** Estados en los que la cita todavía puede reprogramarse o cancelarse (CU-07). */
export const ESTADOS_MODIFICABLES: EstadoCita[] = ['pendiente_confirmacion', 'pendiente_adelanto', 'confirmada'];
/** P8: el paciente puede reprogramar o cancelar por la web hasta 24 h antes. */
export const HORAS_LIMITE_PACIENTE = 24;

// ---------- Validaciones reutilizables ----------
export const dniSchema = z.string().regex(/^\d{8}$/, 'El DNI debe tener 8 dígitos');
// P16: mínimo 8 caracteres, letras y números
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir letras')
  .regex(/\d/, 'La contraseña debe incluir números');
export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (aaaa-mm-dd)');
export const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (hh:mm)');
const telefonoSchema = z.string().regex(/^\d{9}$/, 'El teléfono debe tener 9 dígitos');

// ---------- Auth (CU-01 / CU-02) ----------
export const loginSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(1, 'Ingrese su contraseña'),
});
export const recuperarSchema = z.object({ email: z.string().email('Correo inválido') });
export const restablecerSchema = z.object({ token: z.string().min(10), password: passwordSchema });

// ---------- Paciente (CU-03) ----------
export const pacienteSchema = z.object({
  dni: dniSchema,
  nombres: z.string().trim().min(2, 'Ingrese los nombres'),
  apellidos: z.string().trim().min(2, 'Ingrese los apellidos'),
  fechaNacimiento: fechaSchema,
  telefono: telefonoSchema,
  email: z.string().email('Correo inválido').optional().or(z.literal('').transform(() => undefined)),
  direccion: z.string().trim().optional(),
  apoderado: z.string().trim().optional(), // P14
  alergias: z.string().trim().optional(),
  antecedentes: z.string().trim().optional(),
});
export type PacienteDTO = z.infer<typeof pacienteSchema>;

/** Registro web: el paciente crea su propia cuenta (correo obligatorio). */
export const registroPacienteSchema = pacienteSchema.extend({
  email: z.string().email('Correo inválido'),
  password: passwordSchema,
});
export type RegistroPacienteDTO = z.infer<typeof registroPacienteSchema>;

// ---------- Disponibilidad (CU-05) y cita (CU-06) ----------
export const disponibilidadQuerySchema = z.object({
  odontologoId: z.coerce.number().int().positive('Seleccione un odontólogo'),
  fecha: fechaSchema,
});

export const citaSchema = z.object({
  // Presencial: obligatorio. Web: se ignora y se toma de la sesión.
  pacienteId: z.number().int().positive().optional(),
  odontologoId: z.number().int().positive('Seleccione un odontólogo'),
  fecha: fechaSchema,
  hora: horaSchema,
  motivo: z.string().trim().min(3, 'Indique el motivo de la cita').max(200),
});
export type CitaDTO = z.infer<typeof citaSchema>;

// ---------- CU-04 Actualizar datos de contacto ----------
export const contactoSchema = z.object({
  telefono: telefonoSchema,
  email: z.string().email('Correo inválido').optional().or(z.literal('').transform(() => undefined)),
  direccion: z.string().trim().optional(),
  apoderado: z.string().trim().optional(),
});
export type ContactoDTO = z.infer<typeof contactoSchema>;

// ---------- CU-07 Reprogramar / cancelar ----------
export const reprogramarSchema = z.object({
  odontologoId: z.number().int().positive('Seleccione un odontólogo'),
  fecha: fechaSchema,
  hora: horaSchema,
});
export type ReprogramarDTO = z.infer<typeof reprogramarSchema>;

// ---------- CU-08 Confirmar cita ----------
export const confirmacionSchema = z.object({ accion: z.enum(['confirmar', 'cancelar']) });

export interface CitaConfirmacion {
  paciente: string;
  odontologo: string;
  fecha: string;
  hora: string;
  estado: EstadoCita;
  puedeResponder: boolean;
  mensaje?: string;
}

// ---------- Tarifario (CU-14..17) ----------
const dinero = z.coerce
  .number({ invalid_type_error: 'Ingrese un monto' })
  .positive('El precio debe ser mayor que 0')
  .max(99_999_999, 'Monto demasiado alto')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Máximo 2 decimales');
const cantidad = z.coerce.number({ invalid_type_error: 'Ingrese una cantidad' }).positive('La cantidad debe ser mayor que 0');
const noNegativo = z.coerce.number({ invalid_type_error: 'Ingrese un número' }).min(0, 'No puede ser negativo');

export const tratamientoSchema = z.object({
  nombre: z.string().trim().min(2, 'Ingrese el nombre').max(120),
  precio: dinero,
  insumos: z
    .array(z.object({ insumoId: z.coerce.number().int().positive('Elija un insumo'), cantidad }))
    .refine((l) => new Set(l.map((i) => i.insumoId)).size === l.length, 'Un insumo aparece dos veces'),
});
export type TratamientoDTO = z.infer<typeof tratamientoSchema>;

// ---------- Insumos (CU-18..21) ----------
export const insumoSchema = z.object({
  nombre: z.string().trim().min(2, 'Ingrese el nombre').max(120),
  unidad: z.string().trim().min(1, 'Ingrese la unidad (p. ej. unidad, caja, jeringa)').max(30),
  stockMinimo: noNegativo,
});
/** Al registrar se indica el stock inicial; después solo cambia por recepción o ajuste. */
export const insumoNuevoSchema = insumoSchema.extend({ stockInicial: noNegativo });
export type InsumoDTO = z.infer<typeof insumoSchema>;
export type InsumoNuevoDTO = z.infer<typeof insumoNuevoSchema>;

// ---------- Atención (CU-11) ----------
/** Piezas permanentes en notación FDI: cuadrantes 1–4, piezas 1–8 (11–18, 21–28, 31–38, 41–48). */
export const PIEZAS_FDI = [1, 2, 3, 4].flatMap((c) => [1, 2, 3, 4, 5, 6, 7, 8].map((p) => `${c}${p}`));
export const atencionSchema = z.object({
  diagnostico: z.string().trim().min(3, 'Ingrese el diagnóstico').max(2000),
  observaciones: z.string().trim().max(2000).optional(),
  tratamientos: z
    .array(
      z.object({
        tratamientoId: z.coerce.number().int().positive('Elija un tratamiento'),
        piezaDental: z
          .string()
          .refine((p) => PIEZAS_FDI.includes(p), 'Pieza dental inválida (FDI 11–48)')
          .optional()
          .or(z.literal('').transform(() => undefined)),
      }),
    )
    .min(1, 'Agregue al menos un tratamiento'),
});
export type AtencionDTO = z.infer<typeof atencionSchema>;

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  campos?: Record<string, string>;
}

export interface UsuarioSesion {
  id: number;
  nombres: string;
  email: string;
  rol: Rol;
  pacienteId?: number | null;
  odontologoId?: number | null;
}

export interface Disponibilidad {
  fecha: string;
  atiende: boolean;
  horarios: string[];
  mensaje?: string;
  siguienteFechaDisponible?: string | null;
}
