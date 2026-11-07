// Búsqueda tolerante: insumos (interfaz) y pacientes por nombre (API).
// Búsqueda tolerante para listas pequeñas (insumos): sin tildes ni mayúsculas, por cualquier parte del nombre
// y aceptando errores de escritura («anestecia» → «Anestesia lidocaína 2 %»).
export const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Distancia de edición (Levenshtein) entre dos palabras cortas. */
function distancia(a: string, b: string) {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = tmp;
    }
  }
  return fila[b.length];
}

/**
 * Puntaje de un nombre frente a lo escrito: 0 = lo contiene; 1, 2… = errores tolerados; null = no coincide.
 * Cada palabra escrita se compara con el comienzo de cada palabra del nombre.
 */
export function puntaje(nombre: string, consulta: string): number | null {
  const n = normalizar(nombre);
  const q = normalizar(consulta);
  if (!q) return 0;
  if (n.includes(q)) return 0;
  const palabras = n.split(/\s+/);
  let total = 0;
  for (const w of q.split(/\s+/)) {
    if (n.includes(w)) continue;
    const mejor = Math.min(...palabras.map((p) => distancia(w, p.slice(0, Math.max(w.length, 3)))));
    const tolerancia = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0;
    if (mejor > tolerancia) return null;
    total += mejor;
  }
  return total;
}

/**
 * Filtra y ordena: primero los que contienen lo escrito, luego los aproximados; a igualdad, los marcados
 * como prioritarios (p. ej. en stock mínimo) y después por nombre. Sin texto: todos.
 */
export function buscar<T extends { nombre: string }>(lista: T[], consulta: string, prioritario: (x: T) => boolean = () => false) {
  return lista
    .map((x) => ({ x, p: puntaje(x.nombre, consulta) }))
    .filter((r): r is { x: T; p: number } => r.p !== null)
    .sort((a, b) => a.p - b.p || Number(prioritario(b.x)) - Number(prioritario(a.x)) || a.x.nombre.localeCompare(b.x.nombre, 'es'))
    .map((r) => ({ item: r.x, aproximado: r.p > 0 }));
}
