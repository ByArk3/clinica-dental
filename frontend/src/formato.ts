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

/** Errores de un safeParse de Zod → { campo: mensaje } (el primero por campo). */
export function erroresZod(issues: { path: (string | number)[]; message: string }[]) {
  const c: Record<string, string> = {};
  for (const i of issues) c[i.path.join('.')] ??= i.message;
  return c;
}

/** Campos con error devueltos por la API (422/409), si los hay. */
export const camposApi = (e: unknown): Record<string, string> =>
  (e as { datos?: { campos?: Record<string, string> } })?.datos?.campos ?? {};

export const fechaHoraPE = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export const numPE = (n: string | number) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 });

/** Edad en años cumplidos a hoy (hora de Lima) para una fecha aaaa-mm-dd. */
export function edadDe(fechaNacimiento: string) {
  const [a, m, d] = fechaNacimiento.split('-').map(Number);
  const [ha, hm, hd] = hoyLima().split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}
