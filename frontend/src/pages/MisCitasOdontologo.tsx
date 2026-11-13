import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { atencionApi } from '../api/recursos';
import { ChipEstado } from '../components/ChipEstado';
import { fechaPE, hoyLima } from '../formato';
import { fechaMaximaFutura } from '@clinica/shared';
import { DniPaciente } from '../components/DniPaciente';

/** CU-11 paso 1: «Citas del día» del odontólogo (toda su agenda de una fecha; para atender, «Registrar atención»). */
export default function MisCitasOdontologo() {
  const [fecha, setFecha] = useState(hoyLima());
  const citas = useQuery({ queryKey: ['mis-citas-od', fecha], queryFn: () => atencionApi.misCitas(fecha), refetchInterval: 60_000 });

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
        <h1 className="h4 mb-0">Citas del día</h1>
        <div>
          <label htmlFor="fecha-od" className="form-label small mb-1">Fecha</label>
          <input id="fecha-od" type="date" max={fechaMaximaFutura()} className="form-control" value={fecha} onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= fechaMaximaFutura() && setFecha(e.target.value)} />
        </div>
      </div>
      {citas.isLoading && <p className="text-muted">Cargando…</p>}
      {citas.data?.length === 0 && <div className="tarjeta text-muted">No tiene citas confirmadas el {fechaPE(fecha)}.</div>}
      <div className="d-grid gap-2">
        {citas.data?.map((c) => (
          <div className="tarjeta py-3" key={c.id}>
            <div className="d-flex flex-wrap justify-content-between gap-2">
              <div>
                <strong className="me-2">{c.hora}</strong>
                {c.paciente.nombres} {c.paciente.apellidos}
                <span className="small text-muted"> · <DniPaciente dni={c.paciente.dni} /></span>
              </div>
              <ChipEstado estado={c.estado} />
            </div>
            <div className="small text-muted">{c.motivo}</div>
            {c.paciente.alergias && <div className="small text-danger fw-semibold">⚠ Alergias: {c.paciente.alergias}</div>}
            {c.puedeAtender && (
              <Link className="btn btn-sm btn-acento mt-2" to={`/atencion/registrar/${c.id}?fecha=${c.fecha}`}>
                Registrar atención
              </Link>
            )}
            {c.atencionId && (
              <Link className="btn btn-sm btn-outline-secondary mt-2" to={`/atencion/editar/${c.atencionId}`}>
                Editar atención
              </Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
