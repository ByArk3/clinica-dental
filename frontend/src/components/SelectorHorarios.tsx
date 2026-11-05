import type { Disponibilidad } from '@clinica/shared';
import { fechaPE } from '../formato';

interface Props {
  disponibilidad?: Disponibilidad;
  cargando: boolean;
  seleccionado: string | null;
  onSeleccionar: (hora: string) => void;
  onIrAFecha: (fecha: string) => void;
}

/** CU-05: muestra los horarios libres como botones (RNF01: agendar en < 2 min). */
export function SelectorHorarios({ disponibilidad, cargando, seleccionado, onSeleccionar, onIrAFecha }: Props) {
  if (cargando) return <p className="text-muted">Buscando horarios…</p>;
  if (!disponibilidad) return <p className="text-muted">Elija odontólogo y fecha para ver los horarios.</p>;
  if (disponibilidad.horarios.length === 0) {
    return (
      <div className="alert alert-warning" role="alert">
        {disponibilidad.mensaje}
        {disponibilidad.siguienteFechaDisponible && (
          <>
            {' '}
            <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => onIrAFecha(disponibilidad.siguienteFechaDisponible!)}>
              Ver el {fechaPE(disponibilidad.siguienteFechaDisponible)}
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="grilla-horarios" role="group" aria-label="Horarios disponibles">
      {disponibilidad.horarios.map((h) => (
        <button
          key={h}
          type="button"
          className={`btn btn-sm ${seleccionado === h ? 'btn-acento horario-elegido' : 'btn-outline-secondary'}`}
          aria-pressed={seleccionado === h}
          onClick={() => onSeleccionar(h)}
        >
          {seleccionado === h && <span aria-hidden="true">✓ </span>}
          {h}
        </button>
      ))}
    </div>
  );
}
