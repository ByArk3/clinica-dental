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
} as const;

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
