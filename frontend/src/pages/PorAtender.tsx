import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { atencionApi } from '../api/recursos';
import { DniPaciente } from '../components/DniPaciente';
import { ChipEstado } from '../components/ChipEstado';
import { edadDe, fechaPE, hoyLima } from '../formato';

/**
 * CU-11 «Registrar atención» (menú del odontólogo): el único lugar desde donde se atiende. Arriba, los pacientes de hoy
 * que faltan atender (el siguiente destacado); abajo, los ya atendidos hoy, con «Editar atención».
 */
export default function PorAtender() {
  const hoy = hoyLima();
  const citas = useQuery({ queryKey: ['mis-citas-od', hoy], queryFn: () => atencionApi.misCitas(hoy), refetchInterval: 60_000 });
  const pendientes = (citas.data ?? []).filter((c) => c.puedeAtender).sort((a, b) => a.hora.localeCompare(b.hora));
  const atendidas = (citas.data ?? []).filter((c) => c.atencionId).sort((a, b) => a.hora.localeCompare(b.hora));

  return (
    <>
      <h1 className="h4 mb-2">Registrar atención · {fechaPE(hoy)}</h1>
      {citas.data && (
        <div className="d-flex flex-wrap gap-2 mb-3" aria-label="Resumen del día">
          <span className="chip chip-confirmada">{pendientes.length} por atender</span>
          <span className="chip chip-pagada">{atendidas.length} atendido{atendidas.length === 1 ? '' : 's'}</span>
          {pendientes[0] && <span className="chip chip-atendida">Próximo: {pendientes[0].hora}</span>}
        </div>
      )}
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

      {atendidas.length > 0 && (
        <>
          <h2 className="h6 text-uppercase text-muted mt-4 mb-2">Atendidos hoy</h2>
          <div className="d-grid gap-2" data-testid="atendidos-hoy">
            {atendidas.map((c) => (
              <div className="tarjeta py-2" key={c.id}>
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <div>
                    <strong className="me-2">{c.hora}</strong>
                    {c.paciente.nombres} {c.paciente.apellidos}
                    <span className="ms-2"><ChipEstado estado={c.estado} /></span>
                  </div>
                  <Link className="btn btn-sm btn-outline-secondary" to={`/atencion/editar/${c.atencionId}`}>Editar atención</Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
