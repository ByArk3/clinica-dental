import type { ErrorApi } from '@clinica/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public datos: ErrorApi,
  ) {
    super(datos.mensaje);
  }
}

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
  if (!r.ok) throw new ApiError(r.status, datos);
  return datos as T;
}
