// Formatos de Perú: fechas dd/mm/aaaa, moneda S/ con 2 decimales, zona America/Lima.
export const ZONA = 'America/Lima';

/** 'aaaa-mm-dd' → 'dd/mm/aaaa' */
export const fechaPE = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export const solesPE = (monto: number | string) =>
  `S/ ${Number(monto).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Fecha de hoy en Lima como 'aaaa-mm-dd' (para el mínimo del selector de fecha). */
export const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());

export const diaSemanaPE = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** Horas que faltan para una cita (Lima es UTC-5 todo el año). */
export const horasPara = (fecha: string, hora: string) =>
  (new Date(`${fecha}T${hora}:00-05:00`).getTime() - Date.now()) / 3_600_000;

export const mensajeError = (e: unknown) =>
  e && typeof e === 'object' && 'datos' in e ? (e as { datos: { mensaje: string } }).datos.mensaje : 'No se pudo conectar con el servidor';
