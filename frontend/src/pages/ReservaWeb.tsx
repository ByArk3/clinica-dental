import { useQuery } from '@tanstack/react-query';
import { citasApi } from '../api/recursos';
import { FormReserva } from '../components/FormReserva';
import { ChipEstado } from '../components/ChipEstado';
import { fechaPE } from '../formato';

/** CU-06 canal web (i_cita): el paciente reserva desde su celular (RNF02). */
export function ReservaWeb() {
  return (
    <>
      <h1 className="h4 mb-3">Reservar cita</h1>
      <FormReserva />
    </>
  );
}

export function MisCitas() {
  const { data, isLoading } = useQuery({ queryKey: ['mis-citas'], queryFn: citasApi.mias });
  return (
    <>
      <h1 className="h4 mb-3">Mis citas</h1>
      {isLoading && <p className="text-muted">Cargando…</p>}
      {data?.length === 0 && <p className="text-muted">Aún no tiene citas registradas.</p>}
      <div className="d-grid gap-2">
        {data?.map((c) => (
          <div className="tarjeta py-3" key={c.id}>
            <div className="d-flex justify-content-between flex-wrap gap-2">
              <strong>{fechaPE(c.fecha)} · {c.hora}</strong>
              <ChipEstado estado={c.estado} />
            </div>
            <div className="text-muted small">{c.odontologo} — {c.motivo}</div>
          </div>
        ))}
      </div>
    </>
  );
}
