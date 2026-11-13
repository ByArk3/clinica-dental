import { textoPieza } from './PiezaDental';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ModalEditarDatos } from './ModalEditarDatos';
import type { Historial } from '../api/recursos';
import { useUsuarioOpcional } from '../auth';
import { fechaHoraPE, fechaPE, solesPE } from '../formato';
import { DniPaciente } from './DniPaciente';

const piezas = (t: { nombre: string; piezaDental: string | null }[]) => t.map((x) => (x.piezaDental ? `${x.nombre} — ${textoPieza(x.piezaDental)}` : x.nombre)).join(', ');

/** Ficha y atenciones del paciente (CU-10). Solo se muestra a Odontólogo y Administrador (RN-07). */
export function VistaHistorial({ h, compacto }: { h: Historial; compacto?: boolean }) {
  const usuario = useUsuarioOpcional();
  const [editar, setEditar] = useState(false);
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
          <DniPaciente dni={h.paciente.dni} /> · {edad} años · Cel. {h.paciente.telefono}
          {h.paciente.apoderado && <> · Apoderado: {h.paciente.apoderado}{h.paciente.apoderadoDni && ` (DNI ${h.paciente.apoderadoDni})`}{h.paciente.apoderadoTelefono && ` · Cel. ${h.paciente.apoderadoTelefono}`}</>}
          {usuario?.rol === 'administrador' && (
            <button type="button" className="btn btn-link btn-sm p-0 ms-2 align-baseline" onClick={() => setEditar(true)}>
              Editar datos / DNI
            </button>
          )}
        </p>
        {usuario?.rol === 'administrador' && <ModalEditarDatos pacienteId={editar ? h.paciente.id : null} onCerrar={() => setEditar(false)} />}
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
              <span className="small text-muted">
                {a.odontologo}
                {a.ediciones.length > 0 && <span className="badge text-bg-light border ms-2">Editado</span>}
              </span>
            </div>
            <div className="mt-1"><span className="text-muted small">Diagnóstico:</span> {a.diagnostico}</div>
            <ul className="mb-1 small ps-3">
              {a.tratamientos.map((t, i) => (
                <li key={i}>
                  {t.nombre}
                  {t.piezaDental && <> — {textoPieza(t.piezaDental)}</>} <span className="text-muted">({solesPE(t.precio)})</span>
                </li>
              ))}
            </ul>
            {a.observaciones && <div className="small text-muted">Obs.: {a.observaciones}</div>}
            {a.ediciones.length > 0 && (
              <details className="small mt-2">
                <summary className="text-muted">
                  Editado el {fechaHoraPE(a.ediciones[0].fecha)} por {a.ediciones[0].por} – motivo: {a.ediciones[0].motivo}
                  {a.ediciones.length > 1 && ` (${a.ediciones.length} correcciones)`}
                </summary>
                {a.ediciones.map((e, i) => (
                  <div key={i} className="border-start ps-2 mt-2">
                    <div className="text-muted">{fechaHoraPE(e.fecha)} · {e.por} · {e.motivo}</div>
                    <div>Antes decía — diagnóstico: {e.anterior.diagnostico}</div>
                    <div>Tratamientos: {piezas(e.anterior.tratamientos)}</div>
                    {e.anterior.observaciones && <div>Obs.: {e.anterior.observaciones}</div>}
                  </div>
                ))}
              </details>
            )}
            {!compacto && usuario?.odontologoId === a.odontologoId && (
              <Link className="btn btn-link btn-sm p-0 mt-1 align-self-start" to={`/atencion/editar/${a.id}`}>Editar atención</Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
