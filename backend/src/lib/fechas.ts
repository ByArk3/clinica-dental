// Utilidades de fecha/hora. La clínica opera en America/Lima (UTC-5, sin horario de verano).
// En la BD: `fecha` es DATE y `hora` es TIME; Prisma los representa como Date en UTC
// (1970-01-01THH:MM:00Z para TIME y aaaa-mm-ddT00:00:00Z para DATE).

export const ZONA = 'America/Lima';
const OFFSET_LIMA = '-05:00';

export const fechaADate = (fecha: string) => new Date(`${fecha}T00:00:00Z`);
export const horaADate = (hora: string) => new Date(`1970-01-01T${hora}:00Z`);
export const dateAFecha = (d: Date) => d.toISOString().slice(0, 10);
export const dateAHora = (d: Date) => d.toISOString().slice(11, 16);

/** Instante real de una cita (fecha + hora locales de Lima). */
export const instanteCita = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00${OFFSET_LIMA}`);

/** Fecha y hora actuales en Lima. */
export function ahoraLima(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** 1 = lunes … 7 = domingo */
export function diaSemana(fecha: string) {
  const d = fechaADate(fecha).getUTCDay();
  return d === 0 ? 7 : d;
}

export function sumarDias(fecha: string, dias: number) {
  const d = fechaADate(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return dateAFecha(d);
}

export const minutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};
export const aHora = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
