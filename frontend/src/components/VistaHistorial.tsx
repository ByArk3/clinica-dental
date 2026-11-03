import type { Historial } from '../api/recursos';
import { fechaPE, solesPE } from '../formato';

/** Ficha y atenciones del paciente (CU-10). Solo se muestra a Odontólogo y Administrador (RN-07). */
export function VistaHistorial({ h, compacto }: { h: Historial; compacto?: boolean }) {
  const edad = Math.floor((Date.now() - new Date(`${h.paciente.fechaNacimiento}T00:00:00-05:00`).getTime()) / (365.25 * 86_400_000));
  return (
    <>
      <div className="tarjeta mb-3">
        {!compacto && (
          <h2 className="h5 mb-1">
            {h.paciente.nombres} {h.paciente.apellidos}
          </h2>
        )}
        <p className="small text-muted mb-2">
          DNI {h.paciente.dni} · {edad} años · Cel. {h.paciente.telefono}
          {h.paciente.apoderado && <> · Apoderado: {h.paciente.apoderado}</>}
        </p>
        <dl className="row mb-0 small">
          <dt className="col-4">Alergias</dt>
          <dd className={`col-8 ${h.ficha.alergias ? 'text-danger fw-semibold' : 'text-muted'}`}>{h.ficha.alergias || 'Ninguna registrada'}</dd>
          <dt className="col-4">Antecedentes</dt>
          <dd className="col-8">{h.ficha.antecedentes || <span className="text-muted">Ninguno registrado</span>}</dd>
          {h.ficha.notas && (
            <>
              <dt className="col-4">Notas</dt>
              <dd className="col-8 mb-0" style={{ whiteSpace: 'pre-line' }}>{h.ficha.notas}</dd>
            </>
          )}
        </dl>
      </div>

      <h3 className="h6 text-uppercase text-muted mb-2">Atenciones</h3>
      {h.mensaje && <div className="tarjeta text-muted">{h.mensaje}</div>}
      <div className="d-grid gap-2">
        {h.atenciones.map((a) => (
          <div className="tarjeta py-3" key={a.id}>
            <div className="d-flex flex-wrap justify-content-between gap-2">
              <strong>{fechaPE(a.fecha)} · {a.hora}</strong>
              <span className="small text-muted">{a.odontologo}</span>
            </div>
            <div className="mt-1"><span className="text-muted small">Diagnóstico:</span> {a.diagnostico}</div>
            <ul className="mb-1 small ps-3">
              {a.tratamientos.map((t, i) => (
                <li key={i}>
                  {t.nombre}
                  {t.piezaDental && <> — pieza {t.piezaDental}</>} <span className="text-muted">({solesPE(t.precio)})</span>
                </li>
              ))}
            </ul>
            {a.observaciones && <div className="small text-muted">Obs.: {a.observaciones}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
