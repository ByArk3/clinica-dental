import { useState } from 'react';
import type { Disponibilidad } from '@clinica/shared';
import { fechaPE } from '../formato';

interface Props {
  disponibilidad?: Disponibilidad;
  cargando: boolean;
  seleccionado: string | null;
  onSeleccionar: (hora: string) => void;
  onIrAFecha: (fecha: string) => void;
  /** Si se pasa, ofrece cambiar a otro odontólogo que sí atiende ese día (al reprogramar no se cambia de odontólogo). */
  onCambiarOdontologo?: (odontologoId: number) => void;
}

const VISIBLES = 3; // con muchos odontólogos se muestran los 3 que atienden más temprano y «Ver N más»

/** CU-05: muestra los horarios libres como botones (RNF01: agendar en < 2 min). */
export function SelectorHorarios({ disponibilidad, cargando, seleccionado, onSeleccionar, onIrAFecha, onCambiarOdontologo }: Props) {
  const [verTodas, setVerTodas] = useState(false);
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
        {onCambiarOdontologo && !!disponibilidad.alternativas?.length && (
          <div className="mt-2" data-testid="alternativas">
            <span className="small">O ese mismo día con:</span>
            <div className="d-flex flex-wrap gap-2 mt-1">
              {(verTodas ? disponibilidad.alternativas : disponibilidad.alternativas.slice(0, VISIBLES)).map((a) => (
                <button key={a.odontologoId} type="button" className="btn btn-sm btn-alternativa" onClick={() => onCambiarOdontologo(a.odontologoId)}>
                  <strong>{a.nombres}</strong> · desde {a.primeraHora}
                </button>
              ))}
              {!verTodas && disponibilidad.alternativas.length > VISIBLES && (
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setVerTodas(true)}>
                  Ver {disponibilidad.alternativas.length - VISIBLES} más
                </button>
              )}
            </div>
          </div>
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
