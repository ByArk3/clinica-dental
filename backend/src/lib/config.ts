// Configuración sensible: se valida al arrancar.
import crypto from 'node:crypto';

/** Valores de ejemplo que aparecen en el repositorio: nunca deben usarse en producción. */
export const SECRETOS_DE_EJEMPLO = ['solo-desarrollo', 'cambie-este-secreto-en-produccion', 'cambie-esto-por-un-secreto-largo'];
export const LARGO_MINIMO_SECRETO = 32;

/**
 * Secreto con el que se firman las cookies de sesión.
 * Producción: si falta, es corto o es un valor de ejemplo, el servidor NO arranca (mensaje claro).
 * Desarrollo/pruebas: si falta, se usa uno de desarrollo con un aviso en consola.
 */
export function secretoDeSesion(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.SESSION_SECRET?.trim() ?? '';
  const inseguro = !s || s.length < LARGO_MINIMO_SECRETO || SECRETOS_DE_EJEMPLO.includes(s);
  if (env.NODE_ENV === 'production' && inseguro) {
    throw new Error(
      `SESSION_SECRET no es seguro: defina en .env un valor aleatorio de al menos ${LARGO_MINIMO_SECRETO} caracteres ` +
        `(por ejemplo: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").`,
    );
  }
  if (!s) {
    if (env.NODE_ENV !== 'test') console.warn('[config] SESSION_SECRET sin definir: se usa un secreto de desarrollo. No use esto en producción.');
    return 'solo-desarrollo';
  }
  return s;
}

/** Secreto aleatorio (lo usa el arranque en Docker cuando no se configuró uno). */
export const secretoAleatorio = () => crypto.randomBytes(32).toString('hex');
