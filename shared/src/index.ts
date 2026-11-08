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
  'pago_en_verificacion',
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
  pago_en_verificacion: 'Pago en verificación',
};

export const CANALES = ['web', 'presencial'] as const;
export type Canal = (typeof CANALES)[number];

/** Mensajes exactos de la especificación (sección 9 del brief). */
export const MENSAJES = {
  HORARIO_NO_DISPONIBLE: 'El horario ya no está disponible',
  CLINICA_NO_ATIENDE: 'La clínica no atiende ese día',
  /** El odontólogo elegido no trabaja ese día, pero la clínica sí atiende (con otros odontólogos). */
  odontologoNoAtiende: (nombres: string, dia: string) => `${nombres} no atiende los ${dia}`,
  SIN_HORARIOS: 'No hay horarios disponibles para esa fecha',
  FUERA_DE_HORARIO: 'La hora elegida está fuera del horario de atención',
  HORA_PASADA: 'No se puede reservar en una fecha u hora pasada',
  FECHA_MUY_LEJANA: 'Solo se puede reservar hasta un año adelante',
  PACIENTE_NO_ENCONTRADO: 'Paciente no encontrado',
  DNI_DUPLICADO: 'Ya existe un paciente registrado con ese DNI',
  // Paciente sin DNI y correcciones (CU-58)
  MOTIVO_CORRECCION: 'Indique el motivo de la corrección: cambió un dato de identidad',
  SIN_CAMBIOS: 'No hay cambios para guardar',
  DNI_SOLO_ADMIN: 'Solo el Administrador puede cambiar un DNI ya registrado',
  DNI_RENIEC_NO_COINCIDE: 'Los nombres de RENIEC para ese DNI no coinciden con los del paciente',
  CITA_NO_EDITABLE: 'Esta cita ya no se puede editar',
  TRATAMIENTO_CON_ADELANTO: 'El tratamiento previsto no se puede cambiar: el adelanto ya se pagó o está en verificación',
  EMAIL_DUPLICADO: 'Ya existe una cuenta con ese correo',
  CREDENCIALES_INVALIDAS: 'Correo o contraseña incorrectos',
  SIN_PERMISO: 'No tiene permiso para realizar esta acción',
  NO_AUTENTICADO: 'Su sesión expiró; inicie sesión nuevamente',
  ADELANTO_OBLIGATORIO:
    'Para reservar se paga un adelanto del 50 % del tratamiento (100 % con 3 o más inasistencias). Debe pagarse dentro de 1 hora; si no, el horario se libera',
  ADELANTO_CUBIERTO_SALDO: 'El adelanto se pagó con su saldo a favor: su cita quedó confirmada',
  ALERTA_NO_REABRIBLE: 'El insumo ya está sobre el stock mínimo o tiene otra alerta pendiente',
  CLINICA_FERIADO: 'La clínica no atiende ese día por feriado',
  TRATAMIENTO_PREVISTO_REQUERIDO: 'Elija el tratamiento previsto',
  ADELANTO_VENCIDO: 'El plazo de 1 hora para pagar el adelanto venció; el horario fue liberado',
  PAGO_NO_REPORTABLE: 'Esta cita no tiene un adelanto pendiente de pago',
  PAGO_EN_VERIFICACION: 'El pago del adelanto está en verificación; espere a que la clínica lo confirme',
  PAGO_NO_VERIFICABLE: 'La cita no tiene un pago reportado para verificar',
  HORARIO_INVALIDO: 'Horario inválido',
  FERIADO_DUPLICADO: 'Ya existe un feriado en esa fecha',
  // Seguridad y auditoría
  BILLETERA_NO_ACEPTADA: 'La clínica no recibe pagos por esa billetera',
  SIN_QR: 'La clínica no tiene un QR de pago cargado',
  CUENTA_BLOQUEADA: 'Cuenta bloqueada por 15 minutos por intentos fallidos',
  // Anular comprobante
  ANULACION_SOLO_HOY: 'La recepcionista solo puede anular comprobantes emitidos hoy; pida al administrador que lo anule',
  COMPROBANTE_YA_ANULADO: 'El comprobante ya está anulado',
  SALDO_YA_USADO: 'El saldo a favor que generó este comprobante ya se usó en otro cobro; anule primero ese comprobante',
  ANULAR_SERVICIO_PRIMERO: 'La cita ya fue atendida; anule primero el comprobante del servicio',
  ANULACION_CITA_PASADA: 'La cita ya pasó o cambió de estado; no se puede anular su adelanto',
  // Editar atención
  ATENCION_NO_EDITABLE: 'Solo el odontólogo que registró la atención puede editarla',
  ATENCION_COBRADA: 'La atención ya fue cobrada: solo puede corregir el diagnóstico y las observaciones. Para cambiar tratamientos, la recepcionista debe anular el comprobante',
  ATENCION_SIN_CAMBIOS: 'No hay cambios para guardar',
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
  // CU-13 Caja
  CITA_SIN_COBRO: 'La cita no tiene cobros pendientes',
  TRATAMIENTO_SIN_PRECIO: 'Hay un tratamiento sin precio; no se puede cobrar',
  MONTO_INSUFICIENTE: 'El monto recibido es menor que el total',
  DESCUENTO_NO_VALIDO: 'El descuento no está disponible',
  TIPO_PAGO_NO_VALIDO: 'Elija un tipo de pago válido',
  COMPROBANTE_NO_ENCONTRADO: 'Comprobante no encontrado',
  PACIENTE_SIN_CORREO: 'El paciente no tiene correo registrado',
  ERROR_PDF: 'No se pudo generar el PDF; reintente. El comprobante ya quedó registrado',
  ERROR_CORREO: 'No se pudo enviar el correo; reintente. El comprobante ya quedó registrado',
  // Iteración 4: proveedores y pedidos
  PROVEEDOR_NO_ENCONTRADO: 'Proveedor no encontrado',
  RUC_DUPLICADO: 'Ya existe un proveedor con ese RUC',
  PROVEEDOR_INACTIVO: 'El proveedor no está activo; regístrelo o actívelo antes de hacer el pedido',
  PROVEEDOR_CON_PEDIDOS: 'No se puede desactivar: el proveedor tiene pedidos pendientes',
  SIN_INSUMOS_PEDIDO: 'Agregue al menos un insumo',
  PEDIDO_NO_ENCONTRADO: 'Pedido no encontrado',
  PEDIDO_NO_PENDIENTE: 'El pedido ya no está pendiente',
  SIN_PEDIDOS_PENDIENTES: 'No hay pedidos pendientes de recepción',
  VERIFICACION_REQUERIDA: 'Confirme que verificó lo recibido contra el pedido',
  OBSERVACION_REQUERIDA: 'Hay diferencias con lo pedido: ingrese una observación',
  RECEPCION_INCOMPLETA: 'Ingrese la cantidad recibida de cada insumo del pedido',
  PROVEEDOR_SIN_CORREO: 'El proveedor no tiene correo registrado',
  // CU-24 / CU-25
  ALERTA_NO_ENCONTRADA: 'Alerta no encontrada',
  AJUSTE_NEGATIVO: 'El ajuste dejaría el stock en negativo',
  // Usuarios
  USUARIO_NO_ENCONTRADO: 'Usuario no encontrado',
  NO_DESACTIVARSE: 'No puede desactivar su propia cuenta',
  NO_QUITARSE_ADMIN: 'No puede quitarse el rol de Administrador',
  CAMBIO_ROL_ODONTOLOGO: 'El rol de odontólogo no se puede asignar ni quitar a una cuenta existente; registre un usuario nuevo',
} as const;

/** Estados en los que la cita todavía puede reprogramarse o cancelarse (CU-07). */
export const ESTADOS_MODIFICABLES: EstadoCita[] = ['pendiente_confirmacion', 'pendiente_adelanto', 'confirmada'];
/** Adelanto (toda reserva): 50 % del tratamiento previsto; 100 % con 3 o más inasistencias (RN-12). Plazo: 1 hora. */
export const PORCENTAJE_ADELANTO = 50;
export const PORCENTAJE_ADELANTO_RESTRINGIDO = 100;
/** Vigencia por defecto del saldo a favor (meses; 0 = no vence). Configurable en Configuración → Pagos. */
export const MESES_VIGENCIA_SALDO = 12;
export const MINUTOS_PAGO_ADELANTO = 60;
/** Horario máximo de la clínica (lunes a sábado). Los horarios de los odontólogos deben estar dentro. */
export const HORARIO_CLINICA = { dias: [1, 2, 3, 4, 5, 6], apertura: '08:00', cierre: '20:00' } as const;
/** P8: el paciente puede reprogramar o cancelar por la web hasta 24 h antes. */
export const HORAS_LIMITE_PACIENTE = 24;

// ---------- Validaciones reutilizables ----------
export const dniSchema = z.string().regex(/^\d{8}$/, 'El DNI debe tener 8 dígitos');
// P16: mínimo 8 caracteres, letras y números
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(64, 'La contraseña debe tener como máximo 64 caracteres')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir letras')
  .regex(/\d/, 'La contraseña debe incluir números');

const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/**
 * Contraseña del paciente: además de las reglas generales, no puede ser su DNI ni contener su nombre o apellido
 * (palabras de 3 letras o más, sin importar tildes ni mayúsculas). Devuelve el mensaje de error o null.
 */
export function problemaContrasenaPaciente(password: string, p: { dni?: string | null; nombres?: string; apellidos?: string }) {
  const clave = sinTildes(password);
  if (p.dni && clave.includes(p.dni)) return 'La contraseña no puede ser ni contener su DNI';
  const palabras = (t?: string) => sinTildes(t ?? '').split(/[\s'-]+/).filter((x) => x.length >= 3);
  if (palabras(p.nombres).some((x) => clave.includes(x))) return 'La contraseña no puede contener su nombre';
  if (palabras(p.apellidos).some((x) => clave.includes(x))) return 'La contraseña no puede contener su apellido';
  return null;
}

/** Nombres y apellidos: solo letras (con tildes y ñ), espacios, apóstrofo o guion. */
export const LETRAS_NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/;
/** Quita lo que no puede ir en un nombre (números, símbolos) mientras se escribe. */
export const soloLetras = (texto: string) => texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, '').replace(/ {2,}/g, ' ').slice(0, 60);
const nombreSchema = (vacio: string) =>
  z
    .string()
    .trim()
    .min(2, vacio)
    .max(60, 'Máximo 60 caracteres')
    .regex(LETRAS_NOMBRE, 'Solo letras (sin números ni símbolos)');
export const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (aaaa-mm-dd)')
  .refine((f) => !Number.isNaN(Date.parse(`${f}T00:00:00Z`)) && new Date(`${f}T00:00:00Z`).toISOString().startsWith(f), 'Fecha inválida');

// ---------- Fechas con sentido (hora de Lima) ----------
/** Fecha de hoy en Lima (aaaa-mm-dd), igual en el navegador y en el servidor. */
export const hoyEnLima = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
/** Suma días (o años con `anios`) a una fecha aaaa-mm-dd. */
export function moverFecha(fecha: string, { dias = 0, anios = 0 }: { dias?: number; anios?: number }) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + anios);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Las citas se reservan desde hoy hasta un año adelante. */
export const fechaMaximaCita = (hoy = hoyEnLima()) => moverFecha(hoy, { anios: 1 });
/** Nacimiento: de hoy hacia atrás, como máximo 120 años. */
export const EDAD_MAXIMA = 120;
export const fechaMinimaNacimiento = (hoy = hoyEnLima()) => moverFecha(hoy, { anios: -EDAD_MAXIMA });
export const fechaNacimientoSchema = fechaSchema
  .refine((f) => f <= hoyEnLima(), 'La fecha de nacimiento no puede ser futura')
  .refine((f) => f >= fechaMinimaNacimiento(), `Revise el año: la edad no puede pasar de ${EDAD_MAXIMA} años`);
/** Filtros «desde / hasta» de consultas (reportes, kárdex, auditoría): «hasta» no pasa de hoy. */
export const hastaHoySchema = fechaSchema.refine((f) => f <= hoyEnLima(), 'La fecha final no puede ser posterior a hoy');
export const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (hh:mm)');
const telefonoSchema = z.string().regex(/^\d{9}$/, 'El teléfono debe tener 9 dígitos');

// ---------- Auth (CU-01 / CU-02) ----------
export const loginSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(1, 'Ingrese su contraseña'),
});
/** Bloqueo por intentos fallidos al iniciar sesión */
export const MAX_INTENTOS_LOGIN = 3;
export const MINUTOS_BLOQUEO_LOGIN = 15;

export const ACCIONES_AUDITORIA = ['ver_historial', 'editar_atencion', 'anular_comprobante', 'bloqueo_login', 'desbloqueo_login', 'reabrir_alerta', 'corregir_paciente', 'cambiar_dni', 'editar_cita'] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];
export const ETIQUETA_AUDITORIA: Record<AccionAuditoria, string> = {
  ver_historial: 'Vio el historial clínico',
  editar_atencion: 'Editó una atención',
  anular_comprobante: 'Anuló un comprobante',
  bloqueo_login: 'Cuenta bloqueada por intentos fallidos',
  desbloqueo_login: 'Desbloqueó una cuenta',
  reabrir_alerta: 'Reabrió una alerta de stock',
  corregir_paciente: 'Corrigió datos del paciente',
  cambiar_dni: 'Registró o cambió un DNI',
  editar_cita: 'Editó datos de una cita',
};

/** Campos numéricos: solo dígitos y largo máximo (la interfaz no deja escribir otra cosa; la API también lo valida). */
export const LARGO_NUMERICO = { dni: 8, ruc: 11, celular: 9, operacion: 20, cmp: 6, porcentaje: 3, edad: 2 } as const;
/** Deja solo dígitos y recorta al largo máximo (para pegar «20-4876 5432-1» → «2048765432»). */
export const soloDigitos = (texto: string, max: number) => texto.replace(/\D/g, '').slice(0, max);

export const motivoSchema = z.object({ motivo: z.string().trim().min(5, 'Indique el motivo (mínimo 5 caracteres)').max(300) });

export const recuperarSchema = z.object({ email: z.string().email('Correo inválido') });
export const restablecerSchema = z.object({ token: z.string().min(10), password: passwordSchema });

// ---------- Paciente (CU-03) ----------
/** Menor de edad (según la fecha de nacimiento, hora de Lima): debe tener apoderado. */
export const MAYORIA_DE_EDAD = 18;
export function esMenorDeEdad(fechaNacimiento: string, hoy = hoyEnLima()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento) && fechaNacimiento > moverFecha(hoy, { anios: -MAYORIA_DE_EDAD });
}
export const MENSAJE_APODERADO = 'Para menores de 18 años, registre los datos del apoderado';
/** Regla común: menor de 18 → apoderado obligatorio (registro web, presencial, sin DNI y Editar datos). */
function exigirApoderado(d: { fechaNacimiento: string; apoderado?: string | null; sexo?: string | null }, ctx: z.RefinementCtx) {
  // el sexo se revisa aquí (y no en el campo) para mostrar todos los faltantes a la vez
  if (!d.sexo) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sexo'], message: 'Elija el sexo' });
  if (esMenorDeEdad(d.fechaNacimiento) && (d.apoderado ?? '').trim().length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apoderado'], message: MENSAJE_APODERADO });
  }
}
const sexoObligatorio = z.enum(['femenino', 'masculino'], { errorMap: () => ({ message: 'Elija el sexo' }) }).nullish();

const pacienteBase = z.object({
  dni: dniSchema,
  nombres: nombreSchema('Ingrese los nombres'),
  apellidos: nombreSchema('Ingrese los apellidos'),
  fechaNacimiento: fechaNacimientoSchema,
  telefono: telefonoSchema,
  email: z.string().email('Correo inválido').optional().or(z.literal('').transform(() => undefined)),
  direccion: z.string().trim().optional(),
  apoderado: z.string().trim().optional(), // P14
  alergias: z.string().trim().optional(),
  antecedentes: z.string().trim().optional(),
  sexo: sexoObligatorio,
});
/** Registro presencial con DNI (el correo es opcional). */
export const pacienteSchema = pacienteBase.superRefine(exigirApoderado);
export type PacienteDTO = z.infer<typeof pacienteSchema>;
export const SEXOS = ['femenino', 'masculino'] as const;
export type Sexo = (typeof SEXOS)[number];
export const ETIQUETA_SEXO: Record<Sexo, string> = { femenino: 'Femenino', masculino: 'Masculino' };

/** Registro presencial sin DNI a la mano: queda «DNI pendiente»; el sexo y el celular son obligatorios para distinguirlo. */
export const pacienteSinDniSchema = pacienteBase.omit({ dni: true }).superRefine(exigirApoderado);
export type PacienteSinDniDTO = z.infer<typeof pacienteSinDniSchema>;

/** Búsqueda por nombre (recepcionista): apellidos obligatorios, nombres opcionales. */
export const buscarNombreSchema = z.object({
  apellidos: z.string().trim().min(2, 'Escriba al menos 2 letras del apellido'),
  nombres: z.string().trim().optional(),
  fechaNacimiento: fechaSchema.optional(),
});

/** CU-58 Corregir datos del paciente. Contacto: libre. Identidad (nombres, apellidos, nacimiento, sexo): pide motivo y queda en la auditoría. */
export const editarPacienteSchema = z.object({
  telefono: telefonoSchema,
  email: z.string().email('Correo inválido').optional().or(z.literal('').transform(() => undefined)),
  direccion: z.string().trim().optional(),
  apoderado: z.string().trim().optional(),
  nombres: nombreSchema('Ingrese los nombres'),
  apellidos: nombreSchema('Ingrese los apellidos'),
  fechaNacimiento: fechaNacimientoSchema,
  sexo: sexoObligatorio,
  motivo: z.string().trim().max(300).optional(),
}).superRefine(exigirApoderado);
export type EditarPacienteDTO = z.infer<typeof editarPacienteSchema>;

/** Completar DNI (recepcionista, si está pendiente) o cambiarlo (solo Administrador, con motivo). */
export const dniPacienteSchema = z.object({
  dni: dniSchema,
  motivo: z.string().trim().max(300).optional(),
  // Si RENIEC devuelve otros nombres, se pide confirmar antes de guardar
  confirmar: z.boolean().optional(),
});

/** Editar datos de la cita: motivo y (si el adelanto no se pagó) tratamiento previsto. */
export const editarCitaSchema = z.object({
  motivo: z.string().trim().min(3, 'Indique el motivo de la cita').max(200),
  tratamientoPrevistoId: z.coerce.number().int().positive().optional(),
});

/** Registro web: el paciente crea su propia cuenta (correo obligatorio). */
export const registroPacienteSchema = pacienteBase
  .extend({
    // el correo (obligatorio en la web) se revisa junto con las demás reglas, para mostrar todos los faltantes a la vez
    email: z.string().trim().optional(),
    password: passwordSchema,
  })
  .superRefine(exigirApoderado)
  .superRefine((d, ctx) => {
    if (!d.email) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Ingrese su correo' });
    else if (!z.string().email().safeParse(d.email).success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Correo inválido' });
    const problema = problemaContrasenaPaciente(d.password, d);
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: problema });
  });
export type RegistroPacienteDTO = z.infer<typeof registroPacienteSchema> & { email: string };

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
  // Sirve para calcular el adelanto (si corresponde) y para la agenda. Por defecto: Consulta.
  tratamientoPrevistoId: z.coerce.number().int().positive().optional().nullable(),
});
export type CitaDTO = z.infer<typeof citaSchema>;

/** Imagen como data URL (png/jpeg/webp) de hasta 2 MB. */
function imagenDataUrl(formato: string, tamano: string) {
  return z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, formato)
    .refine((d) => Math.floor(((d.length - d.indexOf(',') - 1) * 3) / 4) <= MAX_CAPTURA_BYTES, tamano);
}

/**
 * Formato del número de operación según la billetera:
 * Yape: solo números, de 4 a 8 dígitos. Plin (lo emite la app de cada banco): letras y números, de 12 a 20 caracteres.
 */
export const FORMATO_OPERACION = {
  yape: { min: 4, max: 8, soloDigitos: true, ayuda: 'Solo números, máximo 8 (está en la constancia de Yape).' },
  plin: { min: 12, max: 20, soloDigitos: false, ayuda: 'Letras y números, de 12 a 20 (cópielo de la constancia de su banco).' },
} as const;
/** Deja en el campo solo lo permitido para la billetera (en mayúsculas para Plin), hasta el largo máximo. */
export const limpiarOperacion = (metodo: 'yape' | 'plin', texto: string) =>
  FORMATO_OPERACION[metodo].soloDigitos
    ? texto.replace(/\D/g, '').slice(0, FORMATO_OPERACION.yape.max)
    : texto.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, FORMATO_OPERACION.plin.max);

/** El paciente reporta su pago de adelanto por Yape/Plin (opción 1: verificación manual en caja). */
const MAX_CAPTURA_BYTES = 2 * 1024 * 1024;
export const reportarPagoSchema = z
  .object({
    metodo: z.enum(['yape', 'plin'], { errorMap: () => ({ message: 'Elija Yape o Plin' }) }),
    numeroOperacion: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'Ingrese el número de operación que le dio la aplicación')
      .regex(/^[A-Z0-9]+$/, 'El número de operación tiene solo letras y números')
      .min(4, 'El número de operación es demasiado corto')
      .max(20, 'El número de operación tiene como máximo 20 caracteres'),
    // Imagen opcional como data URL (png/jpeg/webp), máx. 2 MB
    captura: imagenDataUrl('La captura debe ser una imagen PNG, JPG o WEBP', 'La captura no debe pasar de 2 MB').optional(),
  })
  .superRefine((d, ctx) => {
    const f = FORMATO_OPERACION[d.metodo];
    const n = d.numeroOperacion;
    const error = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numeroOperacion'], message });
    if (d.metodo === 'yape') {
      if (!/^\d+$/.test(n)) return error('El número de operación de Yape tiene solo números');
      if (n.length < f.min) return error(`El número de operación de Yape debe tener al menos ${f.min} dígitos`);
      if (n.length > f.max) return error(`El número de operación de Yape tiene como máximo ${f.max} dígitos`);
    } else {
      if (!/^[A-Z0-9]+$/.test(n)) return error('El código de operación de Plin tiene solo letras y números');
      if (n.length < f.min || n.length > f.max) return error(`El código de operación de Plin tiene de ${f.min} a ${f.max} caracteres`);
    }
  });
export type ReportarPagoDTO = z.infer<typeof reportarPagoSchema>;
export const rechazarPagoSchema = z.object({ motivo: z.string().trim().min(5, 'Indique el motivo del rechazo').max(300) });
export const cancelarCitaSchema = z.object({ porClinica: z.boolean().optional() });

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
/** Editar una atención: los mismos datos y el motivo de la corrección (queda en el historial). */
export const editarAtencionSchema = atencionSchema.merge(motivoSchema);
export type EditarAtencionDTO = z.infer<typeof editarAtencionSchema>;

// ---------- Caja (CU-13) ----------
export type TipoCobro = 'servicio' | 'adelanto';
export const comprobanteSchema = z.object({
  tipoPagoId: z.coerce.number({ invalid_type_error: 'Elija un tipo de pago' }).int().positive('Elija un tipo de pago'),
  // Solo se usa en efectivo; con tarjeta o Yape/Plin se cobra el total exacto
  montoRecibido: z.coerce
    .number({ invalid_type_error: 'Ingrese el monto recibido' })
    .min(0, 'No puede ser negativo')
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Máximo 2 decimales')
    .optional(),
});
export type ComprobanteDTO = z.infer<typeof comprobanteSchema>;

export interface LineaImporte {
  tratamientoId: number | null;
  descripcion: string;
  precio: string; // precio de lista
  descuento: string; // descuento de campaña de la línea
  campana: string | null;
}
export interface Importe {
  citaId: number;
  tipo: TipoCobro;
  paciente: { id: number; dni: string | null; nombres: string; apellidos: string; email: string | null };
  lineas: LineaImporte[];
  subtotal: string;
  descuento: string; // suma de los descuentos de campaña
  adelantoAplicado: string;
  saldoAplicado: string; // saldo a favor usado en este cobro
  sobrante: string; // adelanto que no se usó → pasa a saldo a favor
  total: string;
  pagoReportado?: { metodo: 'yape' | 'plin'; numeroOperacion: string; reportadoEn: string; tieneCaptura: boolean } | null;
}

// ---------- Proveedores (CU-26..29) ----------
const vacioAUndef = z.literal('').transform(() => undefined);
export const proveedorSchema = z.object({
  ruc: z.string().regex(/^\d{11}$/, 'El RUC debe tener 11 dígitos'),
  razonSocial: z.string().trim().min(3, 'Ingrese la razón social').max(150),
  contacto: z.string().trim().max(100).optional().or(vacioAUndef),
  telefono: z.string().regex(/^\d{6,9}$/, 'Teléfono inválido (6 a 9 dígitos)').optional().or(vacioAUndef),
  email: z.string().email('Correo inválido').optional().or(vacioAUndef),
});
export type ProveedorDTO = z.infer<typeof proveedorSchema>;

// ---------- Pedidos (CU-30..33) ----------
export const ESTADOS_PEDIDO = ['pendiente', 'recibido', 'recibido_con_diferencias', 'anulado'] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];
export const ETIQUETA_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  pendiente: 'Pendiente',
  recibido: 'Recibido',
  recibido_con_diferencias: 'Recibido con diferencias',
  anulado: 'Anulado',
};
export const pedidoSchema = z.object({
  proveedorId: z.coerce.number({ invalid_type_error: 'Elija un proveedor' }).int().positive('Elija un proveedor'),
  insumos: z
    .array(z.object({ insumoId: z.coerce.number().int().positive('Elija un insumo'), cantidad }))
    .min(1, 'Agregue al menos un insumo')
    .refine((l) => new Set(l.map((i) => i.insumoId)).size === l.length, 'Un insumo aparece dos veces'),
});
export type PedidoDTO = z.infer<typeof pedidoSchema>;
export const anularPedidoSchema = z.object({ motivo: z.string().trim().min(5, 'Indique el motivo de la anulación').max(300) });
export const recepcionSchema = z.object({
  verificado: z.literal(true, { errorMap: () => ({ message: 'Confirme que verificó lo recibido contra el pedido' }) }),
  items: z.array(z.object({ detalleId: z.coerce.number().int().positive(), cantidadRecibida: noNegativo })).min(1),
  observacion: z.string().trim().max(500).optional().or(vacioAUndef),
});
export type RecepcionDTO = z.infer<typeof recepcionSchema>;

// ---------- CU-25 Ajuste de stock ----------
export const ajusteSchema = z.object({
  tipo: z.enum(['ajuste', 'merma'], { errorMap: () => ({ message: 'Elija el tipo de movimiento' }) }),
  /** ajuste: con signo (+ suma, − resta). merma: positiva (siempre resta). */
  cantidad: z.coerce.number({ invalid_type_error: 'Ingrese una cantidad' }).refine((n) => n !== 0, 'La cantidad no puede ser 0'),
  motivo: z.string().trim().min(5, 'Indique el motivo').max(300),
}).refine((a) => a.tipo !== 'merma' || a.cantidad > 0, { message: 'La merma debe ser una cantidad positiva', path: ['cantidad'] });
export type AjusteDTO = z.infer<typeof ajusteSchema>;

// ---------- Usuarios (CU-34..37) ----------
export const ROLES_PERSONAL = ['recepcionista', 'odontologo', 'administrador'] as const;
export const usuarioSchema = z.object({
  nombres: z.string().trim().min(3, 'Ingrese los nombres').max(120),
  email: z.string().email('Correo inválido'),
  rol: z.enum(ROLES_PERSONAL, { errorMap: () => ({ message: 'Elija un rol' }) }),
  cmp: z.string().trim().regex(/^\d{1,6}$/, 'El CMP tiene hasta 6 dígitos').optional().or(vacioAUndef),
  especialidad: z.string().trim().max(80).optional().or(vacioAUndef),
});
export const usuarioNuevoSchema = usuarioSchema.extend({ password: passwordSchema });
/** Modificar: la contraseña es opcional (vacía = no cambia). */
export const usuarioModificarSchema = usuarioSchema.extend({ password: passwordSchema.optional().or(vacioAUndef) });
export type UsuarioNuevoDTO = z.infer<typeof usuarioNuevoSchema>;
export type UsuarioModificarDTO = z.infer<typeof usuarioModificarSchema>;

// ---------- Campañas de descuento ----------
export const descuentoSchema = z
  .object({
    nombre: z.string().trim().min(3, 'Ingrese el nombre').max(80),
    tipo: z.enum(['porcentaje', 'tres_por_dos']).default('porcentaje'),
    porcentaje: z.coerce.number({ invalid_type_error: 'Ingrese un porcentaje' }).int('Solo números enteros').gt(0, 'Debe ser mayor que 0').max(100, 'Máximo 100 %').optional().nullable(),
    fechaInicio: fechaSchema,
    fechaFin: fechaSchema,
    edadMaxima: z.coerce.number().int('Solo números enteros').min(0).max(99, 'Máximo 99 años').optional().nullable(),
    tratamientos: z.array(z.coerce.number().int().positive()).min(1, 'Elija al menos un tratamiento'),
  })
  .refine((d) => d.fechaInicio <= d.fechaFin, { message: 'La fecha de inicio debe ser anterior al fin', path: ['fechaFin'] })
  .refine((d) => d.fechaFin >= hoyEnLima(), { message: 'La campaña debe terminar hoy o después', path: ['fechaFin'] })
  .refine((d) => d.tipo === 'tres_por_dos' || (d.porcentaje ?? 0) > 0, { message: 'Ingrese un porcentaje', path: ['porcentaje'] });
export type DescuentoDTO = z.infer<typeof descuentoSchema>;

// ---------- Feriados y horarios ----------
export const feriadoSchema = z.object({
  fecha: fechaSchema.refine((f) => f >= hoyEnLima(), 'El feriado debe ser de hoy en adelante'),
  nombre: z.string().trim().min(3, 'Ingrese el nombre').max(80),
});
export const horarioSchema = z.object({
  tramos: z.array(
    z.object({
      diaSemana: z.coerce.number().int().min(1).max(7),
      horaInicio: horaSchema,
      horaFin: horaSchema,
    }),
  ),
});
export type HorarioDTO = z.infer<typeof horarioSchema>;

/** Datos de Yape/Plin de la clínica que se muestran al paciente para pagar el adelanto. */
export const BILLETERAS = ['yape', 'plin'] as const;
export type Billetera = (typeof BILLETERAS)[number];
export const ETIQUETA_BILLETERA: Record<Billetera, string> = { yape: 'Yape', plin: 'Plin' };
/** Nombre del tipo de pago en caja según las billeteras aceptadas: «Yape», «Plin» o «Yape/Plin». */
export const nombreBilleteras = (b: readonly Billetera[]) => BILLETERAS.filter((x) => b.includes(x)).map((x) => ETIQUETA_BILLETERA[x]).join('/');
export const configPagoSchema = z.object({
  numero: z.string().regex(/^9\d{8}$/, 'Celular de 9 dígitos que empiece con 9'),
  titular: z.string().trim().min(3, 'Ingrese el titular').max(80),
  billeteras: z.array(z.enum(BILLETERAS)).min(1, 'Marque al menos una billetera').default(['yape']),
  saldoVigenciaMeses: z.coerce
    .number({ invalid_type_error: 'Ingrese los meses' })
    .int('Solo meses enteros')
    .min(0, '0 = no vence')
    .max(60, 'Máximo 60 meses')
    .default(MESES_VIGENCIA_SALDO),
});
export type ConfigPagoDTO = z.infer<typeof configPagoSchema>;
/** QR de Yape/Plin de la clínica: imagen PNG, JPG o WEBP de hasta 2 MB (data URL). */
export const qrPagoSchema = z.object({ qr: imagenDataUrl('El QR debe ser una imagen PNG, JPG o WEBP', 'El QR no debe pasar de 2 MB') });

// ---------- Reportes ----------
export const rangoFechasSchema = z
  .object({ desde: fechaSchema, hasta: hastaHoySchema })
  .refine((r) => r.desde <= r.hasta, { message: 'La fecha inicial debe ser anterior a la final', path: ['hasta'] });

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
  /** Otros odontólogos con horarios libres ese mismo día (los que haya; ordenados por la primera hora libre). */
  alternativas?: AlternativaOdontologo[];
}

export interface AlternativaOdontologo {
  odontologoId: number;
  nombres: string;
  primeraHora: string;
  libres: number;
}
export * from './buscar.js';
