// Modo claro / oscuro (Bootstrap 5.3). Se recuerda en este navegador; por defecto, el del sistema operativo.
export type Tema = 'claro' | 'oscuro';
const CLAVE = 'clinica-tema';

export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t === 'claro' || t === 'oscuro') return t;
  } catch {
    /* sin almacenamiento: se usa el del sistema */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

export function aplicarTema(t: Tema) {
  document.documentElement.setAttribute('data-bs-theme', t === 'oscuro' ? 'dark' : 'light');
  try {
    localStorage.setItem(CLAVE, t);
  } catch {
    /* no se pudo guardar: igual se aplica en esta visita */
  }
}
