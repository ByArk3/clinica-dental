// Pendiente 31: piezas comunes de «Registrar atención» y «Editar atención» (pantalla segmentada).
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Historial } from '../api/recursos';
import { DniPaciente } from './DniPaciente';
import { fechaPE } from '../formato';
import { textoPieza } from './PiezaDental';

/** Tarjeta con título numerado («1 Diagnóstico», «2 Tratamientos»…). */
export function SeccionAtencion({ n, titulo, obligatorio, opcional, children }: { n: number; titulo: string; obligatorio?: boolean; opcional?: boolean; children: ReactNode }) {
  return (
    <section className="tarjeta seccion-atencion">
      <h2 className="h6 d-flex align-items-center gap-2 mb-3">
        <span className="num-seccion" aria-hidden="true">{n}</span>
        <span className={obligatorio ? 'form-label obligatorio mb-0' : ''}>{titulo}</span>
        {opcional && <small className="text-muted fw-normal">(opcional)</small>}
      </h2>
      {children}
    </section>
  );
}

/** Franja del paciente: nombre y datos a la izquierda; alergias destacadas a la derecha. */
export function FranjaPaciente({ nombre, dni, edad, hora, motivo, h, alergias }: { nombre: string; dni: string | null; edad?: number | null; hora: string; motivo: string; h?: Historial; alergias?: string | null }) {
  return (
    <div className="tarjeta py-2 mb-3 d-flex flex-wrap gap-2 gap-md-3 align-items-center franja-paciente" data-testid="franja-paciente">
      <strong>{nombre}</strong>
      <span className="small text-muted">
        {edad != null && <>{edad} años · </>}
        <DniPaciente dni={dni} />
      </span>
      <span className="chip chip-confirmada">{hora}</span>
      <span className="small">Motivo: {motivo}</span>
      {!h && alergias && <span className="small ms-md-auto text-danger fw-semibold">⚠ Alergias: {alergias}</span>}
      {h && (
        <span className="small ms-md-auto">
          {h.ficha.alergias ? <span className="text-danger fw-semibold">⚠ Alergias: {h.ficha.alergias}</span> : <span className="text-muted">Sin alergias registradas</span>}
          {h.ficha.antecedentes && <span className="text-muted"> · Antecedentes: {h.ficha.antecedentes}</span>}
        </span>
      )}
    </div>
  );
}

/** Columna derecha: las 3 últimas atenciones, en corto, con «Ver historial completo». */
export function UltimasAtenciones({ h }: { h: Historial }) {
  const [todas, setTodas] = useState(false);
  const lista = todas ? h.atenciones : h.atenciones.slice(0, 3);
  return (
    <div className="tarjeta">
      <h2 className="h6 text-uppercase text-muted mb-2">Últimas atenciones</h2>
      {h.atenciones.length === 0 && <p className="small text-muted mb-0">El paciente no tiene atenciones registradas.</p>}
      {lista.map((a) => (
        <div className="border-bottom pb-2 mb-2 small" key={a.id}>
          <div className="d-flex justify-content-between gap-2">
            <strong>{fechaPE(a.fecha)}</strong>
            <span className="text-muted">{a.odontologo}</span>
          </div>
          <div>{a.diagnostico}</div>
          <div className="text-muted">{a.tratamientos.map((t) => (t.piezaDental ? `${t.nombre} (${textoPieza(t.piezaDental)})` : t.nombre)).join(', ')}</div>
        </div>
      ))}
      {h.atenciones.length > 3 && (
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setTodas(!todas)}>
          {todas ? 'Ver solo las últimas 3' : `Ver historial completo (${h.atenciones.length})`}
        </button>
      )}
      {h.atenciones.length <= 3 && h.atenciones.length > 0 && <Link to={`/historial?paciente=${h.paciente.id}`} className="small">Abrir en Historial clínico →</Link>}
    </div>
  );
}
