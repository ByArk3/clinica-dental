import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ESTADOS_MODIFICABLES, HORAS_LIMITE_PACIENTE, MENSAJES } from '@clinica/shared';
import { citasApi, type Cita } from '../api/recursos';
import { FormReserva } from '../components/FormReserva';
import { ChipEstado } from '../components/ChipEstado';
import { ModalReprogramar } from '../components/ModalReprogramar';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { PanelPagoAdelanto } from '../components/PanelPagoAdelanto';
import { fechaPE, horasPara, mensajeError, solesPE } from '../formato';

/** CU-06 canal web (i_cita): el paciente reserva desde su celular (RNF02). */
export function ReservaWeb() {
  return (
    <>
      <h1 className="h4 mb-3">Reservar cita</h1>
      <FormReserva />
    </>
  );
}

/** Mis citas + CU-07 (reprogramar / cancelar hasta 24 h antes, P8). */
export function MisCitas() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['mis-citas'], queryFn: citasApi.mias });
  const [reprogramar, setReprogramar] = useState<Cita | null>(null);
  const [cancelar, setCancelar] = useState<Cita | null>(null);
  const cancelacion = useMutation({
    mutationFn: (id: number) => citasApi.cancelar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mis-citas'] });
      setCancelar(null);
    },
  });

  return (
    <>
      <h1 className="h4 mb-3">Mis citas</h1>
      {isLoading && <p className="text-muted">Cargando…</p>}
      {data?.length === 0 && <p className="text-muted">Aún no tiene citas registradas.</p>}
      <div className="d-grid gap-2">
        {data?.map((c) => {
          const modificable = ESTADOS_MODIFICABLES.includes(c.estado) && horasPara(c.fecha, c.hora) > 0;
          const aTiempo = horasPara(c.fecha, c.hora) >= HORAS_LIMITE_PACIENTE;
          return (
            <div className="tarjeta py-3" key={c.id}>
              <div className="d-flex justify-content-between flex-wrap gap-2">
                <strong>{fechaPE(c.fecha)} · {c.hora}</strong>
                <ChipEstado estado={c.estado} />
              </div>
              <div className="text-muted small">{c.odontologo} — {c.motivo}{c.tratamientoPrevisto && ` · ${c.tratamientoPrevisto}`}</div>
              {(c.estado === 'pendiente_adelanto' || c.estado === 'pago_en_verificacion') && (
                <div className="mt-2"><PanelPagoAdelanto cita={c} modo="web" /></div>
              )}
              {c.adelantoPagado && c.estado === 'confirmada' && <div className="small text-success mt-1">Adelanto pagado: {solesPE(c.adelantoPagado)}</div>}
              {c.estado === 'liberada' && c.pagoRechazoMotivo && <div className="small text-danger mt-1">Pago no verificado: {c.pagoRechazoMotivo}</div>}
              {modificable &&
                (aTiempo ? (
                  <div className="d-flex gap-2 mt-2">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setReprogramar(c)}>Reprogramar</button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => setCancelar(c)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="small text-muted mt-2">{MENSAJES.LIMITE_24H}</div>
                ))}
            </div>
          );
        })}
      </div>
      <ModalReprogramar cita={reprogramar} onCerrar={() => setReprogramar(null)} />
      <ModalConfirmar
        abierto={!!cancelar}
        titulo="Cancelar cita"
        textoConfirmar="Sí, cancelar"
        peligro
        procesando={cancelacion.isPending}
        error={cancelacion.isError ? mensajeError(cancelacion.error) : null}
        onConfirmar={() => cancelar && cancelacion.mutate(cancelar.id)}
        onCerrar={() => { setCancelar(null); cancelacion.reset(); }}
      >
        {cancelar && (
          <>
            <p className="mb-0">¿Cancelar su cita del {fechaPE(cancelar.fecha)} a las {cancelar.hora}? El horario quedará libre.</p>
            {cancelar.adelantoPagado && <p className="small text-muted mt-2 mb-0">Su adelanto de {solesPE(cancelar.adelantoPagado)} quedará como saldo a favor para su próxima cita.</p>}
          </>
        )}
      </ModalConfirmar>
    </>
  );
}
