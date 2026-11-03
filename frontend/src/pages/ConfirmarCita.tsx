import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { citasApi } from '../api/recursos';
import { ChipEstado } from '../components/ChipEstado';
import { diaSemanaPE, fechaPE, mensajeError } from '../formato';

/** CU-08 (i_confirmacion): el paciente abre el enlace del recordatorio desde su celular. Sin sesión. */
export default function ConfirmarCita() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const cita = useQuery({ queryKey: ['confirmacion', token], queryFn: () => citasApi.verConfirmacion(token), retry: false });
  const responder = useMutation({
    mutationFn: (accion: 'confirmar' | 'cancelar') => citasApi.responderConfirmacion(token, accion),
    onSuccess: (r) => qc.setQueryData(['confirmacion', token], r),
  });

  return (
    <div className="pantalla-acceso">
      <div className="tarjeta acceso">
        <h1 className="h5 mb-3">🦷 Confirmar cita</h1>
        {cita.isLoading && <p className="text-muted">Cargando…</p>}
        {cita.isError && <div className="alert alert-danger mb-0">{mensajeError(cita.error)}</div>}
        {cita.data && (
          <>
            <p className="mb-1">Hola {cita.data.paciente}, su cita es el</p>
            <p className="fs-5 fw-semibold mb-1 text-capitalize-first">
              {diaSemanaPE(cita.data.fecha)} {fechaPE(cita.data.fecha)} a las {cita.data.hora}
            </p>
            <p className="text-muted">con {cita.data.odontologo}</p>
            <p><ChipEstado estado={cita.data.estado} /></p>
            {cita.data.mensaje && <div className="alert alert-warning">{cita.data.mensaje}</div>}
            {responder.isError && <div className="alert alert-danger" role="alert">{mensajeError(responder.error)}</div>}
            {cita.data.puedeResponder && (
              <div className="d-grid gap-2">
                {cita.data.estado !== 'confirmada' && (
                  <button className="btn btn-acento btn-lg" disabled={responder.isPending} onClick={() => responder.mutate('confirmar')}>
                    Confirmar asistencia
                  </button>
                )}
                <button className="btn btn-outline-danger" disabled={responder.isPending} onClick={() => responder.mutate('cancelar')}>
                  Cancelar cita
                </button>
              </div>
            )}
            {cita.data.estado === 'confirmada' && <p className="text-success small mt-3 mb-0">¡Gracias! Lo esperamos.</p>}
          </>
        )}
      </div>
    </div>
  );
}
