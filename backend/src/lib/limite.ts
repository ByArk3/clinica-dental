// Límite de solicitudes en memoria (ventana deslizante). Suficiente para un solo servidor;
// con varios servidores habría que guardarlo en la base de datos o en Redis.
const limitadores: Limitador[] = [];

export interface Limitador {
  /** true si la solicitud está dentro del límite (y la cuenta); false si lo superó. */
  consumir(clave: string): boolean;
  reiniciar(): void;
}

export function crearLimitador(max: number, ventanaMs: number): Limitador {
  const uso = new Map<string, number[]>();
  const l: Limitador = {
    consumir(clave) {
      const ahora = Date.now();
      const recientes = (uso.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
      if (recientes.length >= max) {
        uso.set(clave, recientes);
        return false;
      }
      recientes.push(ahora);
      uso.set(clave, recientes);
      // limpieza simple para que el mapa no crezca sin fin
      if (uso.size > 10_000) for (const [k, v] of uso) if (v.every((t) => ahora - t >= ventanaMs)) uso.delete(k);
      return true;
    },
    reiniciar: () => uso.clear(),
  };
  limitadores.push(l);
  return l;
}

/** Para las pruebas: vacía todos los contadores. */
export const reiniciarLimites = () => limitadores.forEach((l) => l.reiniciar());
