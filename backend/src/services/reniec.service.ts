// Autocompletar nombres y apellidos con el DNI (RENIEC) mediante un servicio intermedio.
// RENIEC no da acceso directo a clínicas privadas; se usa un proveedor (p. ej. Decolecta, ex apis.net.pe)
// con su token en .env. Si no hay token, se acabaron las consultas o no responde, la recepcionista escribe los datos.
const URL_POR_DEFECTO = 'https://api.decolecta.com/v1/reniec/dni?numero={dni}';
const ESPERA_MS = 5000;

export type ResultadoReniec =
  | { encontrado: true; nombres: string; apellidos: string }
  | { encontrado: false; motivo: 'no_configurado' | 'no_encontrado' | 'no_disponible' };

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
/** «JUAN CARLOS DE LA CRUZ» → «Juan Carlos de la Cruz» */
export function nombrePropio(texto: string) {
  return texto
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Acepta las formas de respuesta de los proveedores más usados en Perú. */
function leerRespuesta(json: unknown): { nombres: string; apellidos: string } | null {
  const raiz = (json ?? {}) as Record<string, unknown>;
  const d = (raiz.data && typeof raiz.data === 'object' ? raiz.data : raiz) as Record<string, unknown>;
  const nombres = texto(d.first_name) || texto(d.nombres);
  const paterno = texto(d.first_last_name) || texto(d.apellidoPaterno) || texto(d.apellido_paterno);
  const materno = texto(d.second_last_name) || texto(d.apellidoMaterno) || texto(d.apellido_materno);
  const apellidos = [paterno, materno].filter(Boolean).join(' ');
  if (!nombres || !apellidos) return null;
  return { nombres: nombrePropio(nombres), apellidos: nombrePropio(apellidos) };
}

export async function consultarDni(dni: string): Promise<ResultadoReniec> {
  const token = process.env.RENIEC_TOKEN;
  if (!token) return { encontrado: false, motivo: 'no_configurado' };
  const url = (process.env.RENIEC_URL || URL_POR_DEFECTO).replace('{dni}', encodeURIComponent(dni));
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(ESPERA_MS) });
    if (r.status === 404 || r.status === 422) return { encontrado: false, motivo: 'no_encontrado' };
    if (!r.ok) return { encontrado: false, motivo: 'no_disponible' }; // token inválido, sin consultas, caído…
    const datos = leerRespuesta(await r.json());
    return datos ? { encontrado: true, ...datos } : { encontrado: false, motivo: 'no_encontrado' };
  } catch {
    return { encontrado: false, motivo: 'no_disponible' };
  }
}
