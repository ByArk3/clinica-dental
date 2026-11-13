import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { atencionApi } from '../api/recursos';
import { DniPaciente } from '../components/DniPaciente';
import { edadDe, fechaPE, hoyLima } from '../formato';

/**
 * CU-11 «Registrar atención» (menú del odontólogo): los pacientes de hoy que faltan atender, en orden de hora,
 * con el siguiente destacado. Al elegir uno se abre el formulario de la atención.
 */
export default function PorAtender() {
  const hoy = hoyLima();
  const citas = useQuery({ queryKey: ['mis-citas-od', hoy], queryFn: () => atencionApi.misCitas(hoy), refetchInterval: 60_000 });
  const pendientes = (citas.data ?? []).filter((c) => c.puedeAtender).sort((a, b) => a.hora.localeCompare(b.hora));
  const atendidas = (citas.data ?? []).filter((c) => c.atencionId).length;

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-1">
        <h1 className="h4 mb-0">Registrar atención</h1>
        <Link to="/atencion" className="small">Ver todas las citas del día →</Link>
      </div>
      <p className="text-muted small mb-3">
        Hoy, {fechaPE(hoy)}: {pendientes.length} por atender{atendidas > 0 && ` · ${atendidas} ya atendida${atendidas > 1 ? 's' : ''}`}.
      </p>
      {citas.isLoading && <p className="text-muted">Cargando…</p>}
      {citas.data && pendientes.length === 0 && <div className="tarjeta text-muted">No hay pacientes por atender hoy.</div>}
      <div className="d-grid gap-2">
        {pendientes.map((c, i) => (
          <div className={`tarjeta py-3 ${i === 0 ? 'border border-2 border-info' : ''}`} key={c.id} data-testid={i === 0 ? 'siguiente-paciente' : undefined}>
            {i === 0 && <div className="small fw-semibold text-info mb-1">Siguiente paciente</div>}
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <strong className="me-2">{c.hora}</strong>
                {c.paciente.nombres} {c.paciente.apellidos}
                <span className="small text-muted"> · {edadDe(c.paciente.fechaNacimiento)} años · <DniPaciente dni={c.paciente.dni} /></span>
                <div className="small text-muted">{c.motivo}</div>
                {c.paciente.alergias && <div className="small text-danger fw-semibold">⚠ Alergias: {c.paciente.alergias}</div>}
              </div>
              <Link className={`btn btn-sm ${i === 0 ? 'btn-acento' : 'btn-outline-secondary'}`} to={`/atencion/registrar/${c.id}?fecha=${c.fecha}`}>
                {i === 0 ? 'Atender ahora' : 'Atender'}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
