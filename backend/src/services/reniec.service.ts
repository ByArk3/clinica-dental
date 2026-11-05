// CU-57 Consultar datos en RENIEC o SUNAT («extend» de CU-03 y de CU-26): autocompletar nombres y apellidos con el DNI
// y la razón social con el RUC mediante un servicio intermedio. Es OPCIONAL: sin token, sin consultas, sin respuesta
// en 5 s o sin datos, el registro sigue a mano.
// Ley 29733 (RNF08): de la respuesta solo se devuelven los campos que se usan (nombres/apellidos, razón social y
// estado); no se guarda la respuesta ni se escribe en el log el DNI/RUC ni lo que devuelve el proveedor.
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

// ---------- RUC (SUNAT), mismo proveedor y token ----------
const URL_SUNAT_POR_DEFECTO = 'https://api.decolecta.com/v1/sunat/ruc?numero={ruc}';

export type ResultadoSunat =
  | { encontrado: true; razonSocial: string; direccion: string | null; estado: string | null; condicion: string | null; aviso: string | null }
  | { encontrado: false; motivo: 'no_configurado' | 'no_encontrado' | 'no_disponible' };

function leerSunat(json: unknown) {
  const raiz = (json ?? {}) as Record<string, unknown>;
  const d = (raiz.data && typeof raiz.data === 'object' ? raiz.data : raiz) as Record<string, unknown>;
  const razonSocial = texto(d.razon_social) || texto(d.razonSocial) || texto(d.nombre_o_razon_social) || texto(d.nombre);
  if (!razonSocial) return null;
  const estado = (texto(d.estado) || null)?.toUpperCase() ?? null;
  const condicion = (texto(d.condicion) || null)?.toUpperCase() ?? null;
  const problemas = [estado && estado !== 'ACTIVO' ? estado : null, condicion && condicion !== 'HABIDO' ? condicion : null].filter(Boolean);
  return {
    razonSocial,
    direccion: texto(d.direccion) || null,
    estado,
    condicion,
    aviso: problemas.length ? `Este RUC figura como ${problemas.join(' / ')} en SUNAT` : null,
  };
}

/** Razón social (y estado del contribuyente) a partir del RUC, para registrar proveedores. */
export async function consultarRuc(ruc: string): Promise<ResultadoSunat> {
  const token = process.env.RENIEC_TOKEN;
  if (!token) return { encontrado: false, motivo: 'no_configurado' };
  const url = (process.env.SUNAT_URL || URL_SUNAT_POR_DEFECTO).replace('{ruc}', encodeURIComponent(ruc));
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(ESPERA_MS) });
    if (r.status === 404 || r.status === 422) return { encontrado: false, motivo: 'no_encontrado' };
    if (!r.ok) return { encontrado: false, motivo: 'no_disponible' };
    const datos = leerSunat(await r.json());
    return datos ? { encontrado: true, ...datos } : { encontrado: false, motivo: 'no_encontrado' };
  } catch {
    return { encontrado: false, motivo: 'no_disponible' };
  }
}
