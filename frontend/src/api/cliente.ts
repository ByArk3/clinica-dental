import type { ErrorApi } from '@clinica/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public datos: ErrorApi,
  ) {
    super(datos.mensaje);
  }
}

/** Se emite cuando la API responde 401 (sesión vencida); AuthProvider lleva al login. */
export const EVENTO_SESION_VENCIDA = 'clinica:sesion-vencida';

/** Cliente HTTP: la interfaz (i_) nunca toca la BD; siempre pasa por la API. */
export async function api<T>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${ruta}`, {
    method: opciones.method ?? 'GET',
    credentials: 'include', // cookie httpOnly de sesión
    headers: opciones.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const datos = await r.json().catch(() => ({ codigo: 'ERROR', mensaje: 'No se pudo conectar con el servidor' }));
  // 401 en una ruta que no es de inicio de sesión → la sesión venció
  if (r.status === 401 && !ruta.startsWith('/auth/')) window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
  if (!r.ok) throw new ApiError(r.status, datos);
  return datos as T;
}
