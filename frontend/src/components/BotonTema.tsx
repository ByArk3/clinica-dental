import { useState } from 'react';
import { aplicarTema, temaGuardado, type Tema } from '../tema';

/** Botón día/noche fijo en la esquina superior derecha, en todas las pantallas (también sin sesión). */
export function BotonTema() {
  const [tema, setTema] = useState<Tema>(temaGuardado);
  const siguiente: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
  const texto = siguiente === 'oscuro' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
  function cambiar() {
    // fundido corto de los colores mientras cambia
    const html = document.documentElement;
    html.classList.add('cambiando-tema');
    aplicarTema(siguiente);
    setTema(siguiente);
    setTimeout(() => html.classList.remove('cambiando-tema'), 300);
  }
  return (
    <button type="button" className="boton-tema" onClick={cambiar} aria-label={texto} title={texto}>
      <span aria-hidden="true">{tema === 'oscuro' ? '☀️' : '🌙'}</span>
    </button>
  );
}
