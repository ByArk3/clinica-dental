import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { citasApi } from '../api/recursos';
import { CitasAgenda } from '../components/CitasAgenda';
import { fechaPE, hoyLima } from '../formato';

/** CU-09 (i_citasDelDia): Agenda — las citas de una fecha (por defecto hoy), con inasistencias y acciones de CU-07. */
export default function CitasDelDia() {
  const [fecha, setFecha] = useState(hoyLima());
  const citas = useQuery({ queryKey: ['citas-del-dia', fecha], queryFn: () => citasApi.delDia(fecha), refetchInterval: 60_000 });
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
        <h1 className="h4 mb-0">Agenda</h1>
        <div>
          <label htmlFor="fecha-dia" className="form-label small mb-1">Fecha</label>
          <input id="fecha-dia" type="date" className="form-control" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </div>
      </div>
      {citas.isLoading && <p className="text-muted">Cargando…</p>}
      <CitasAgenda citas={citas.data} vacio={<div className="tarjeta text-muted">No hay citas el {fechaPE(fecha)}.</div>} />
    </>
  );
}
