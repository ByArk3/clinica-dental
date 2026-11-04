import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ESTADOS_MODIFICABLES } from '@clinica/shared';
import { citasApi, type CitaDelDia } from '../api/recursos';
import { ChipEstado } from '../components/ChipEstado';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { ModalReprogramar } from '../components/ModalReprogramar';
import { fechaPE, hoyLima, horasPara, mensajeError, solesPE } from '../formato';

/** CU-09 (i_citasDelDia): agenda del día, inasistencias y acciones de CU-07 para la recepcionista. */
export default function CitasDelDia() {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoyLima());
  const [inasistencia, setInasistencia] = useState<CitaDelDia | null>(null);
  const [cancelar, setCancelar] = useState<CitaDelDia | null>(null);
  const [reprogramar, setReprogramar] = useState<CitaDelDia | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [porClinica, setPorClinica] = useState(false);

  const citas = useQuery({ queryKey: ['citas-del-dia', fecha], queryFn: () => citasApi.delDia(fecha), refetchInterval: 60_000 });
  const registrar = useMutation({
    mutationFn: (id: number) => citasApi.inasistencia(id),
    onSuccess: (r) => {
      setInasistencia(null);
      setAviso(r.aviso ?? null);
      qc.invalidateQueries({ queryKey: ['citas-del-dia'] });
    },
  });
  const cancelacion = useMutation({
    mutationFn: (id: number) => citasApi.cancelar(id, porClinica),
    onSuccess: (r) => {
      setCancelar(null);
      setPorClinica(false);
      if (r.adelanto) {
        const que = { saldo_a_favor: 'quedó como saldo a favor del paciente', devuelto: 'debe devolverse al paciente (quedó registrado)', perdido: 'se pierde por cancelar con menos de 24 h' }[r.adelanto.resultado];
        setAviso(`Cita cancelada. El adelanto de ${solesPE(r.adelanto.monto)} ${que}.`);
      }
      qc.invalidateQueries({ queryKey: ['citas-del-dia'] });
    },
  });

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
        <h1 className="h4 mb-0">Citas del día</h1>
        <div>
          <label htmlFor="fecha-dia" className="form-label small mb-1">Fecha</label>
          <input id="fecha-dia" type="date" className="form-control" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </div>
      </div>
      {aviso && <div className="alert alert-warning alert-dismissible">{aviso}<button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} /></div>}
      {citas.isLoading && <p className="text-muted">Cargando…</p>}
      {citas.data?.length === 0 && <div className="tarjeta text-muted">No hay citas el {fechaPE(fecha)}.</div>}
      <div className="d-grid gap-2">
        {citas.data?.map((c) => {
          const modificable = ESTADOS_MODIFICABLES.includes(c.estado) && horasPara(c.fecha, c.hora) > 0;
          return (
            <div className="tarjeta py-3" key={c.id} data-testid={`cita-${c.id}`}>
              <div className="d-flex flex-wrap justify-content-between gap-2">
                <div>
                  <strong className="me-2">{c.hora}</strong>
                  {c.paciente.nombres} {c.paciente.apellidos}
                  <span className="text-muted small"> · DNI {c.paciente.dni} · Cel. {c.paciente.telefono}</span>
                </div>
                <ChipEstado estado={c.estado} />
              </div>
              <div className="text-muted small">{c.odontologo} — {c.motivo} · {c.canal === 'web' ? 'Web' : 'Presencial'}</div>
              <div className="d-flex flex-wrap gap-2 mt-2">
                {c.estado === 'confirmada' && (
                  <button
                    className="btn btn-sm btn-outline-danger"
                    disabled={!c.puedeRegistrarInasistencia}
                    title={c.puedeRegistrarInasistencia ? undefined : 'La hora de la cita aún no pasó'}
                    onClick={() => setInasistencia(c)}
                  >
                    Registrar inasistencia
                  </button>
                )}
                {modificable && (
                  <>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setReprogramar(c)}>Reprogramar</button>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setCancelar(c)}>Cancelar</button>
                  </>
                )}
                {c.estado === 'pendiente_adelanto' && c.montoAdelanto && (
                  <Link className="btn btn-sm btn-outline-warning" to="/caja">Cobrar adelanto {solesPE(c.montoAdelanto)}</Link>
                )}
                {c.whatsapp && (
                  <a className="btn btn-sm btn-outline-success" href={c.whatsapp} target="_blank" rel="noreferrer">
                    Recordar por WhatsApp
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ModalConfirmar
        abierto={!!inasistencia}
        titulo="Registrar inasistencia"
        textoConfirmar="Registrar inasistencia"
        peligro
        procesando={registrar.isPending}
        error={registrar.isError ? mensajeError(registrar.error) : null}
        onConfirmar={() => inasistencia && registrar.mutate(inasistencia.id)}
        onCerrar={() => { setInasistencia(null); registrar.reset(); }}
      >
        {inasistencia && (
          <>
            <p>
              {inasistencia.paciente.nombres} {inasistencia.paciente.apellidos} no asistió a su cita de las {inasistencia.hora}.
            </p>
            <p className="small text-muted mb-0">
              Inasistencias actuales: {inasistencia.paciente.inasistencias}. Con 3, deberá pagar un adelanto para reservar.
            </p>
          </>
        )}
      </ModalConfirmar>

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
        {cancelar && <p className="mb-0">¿Cancelar la cita de {cancelar.paciente.nombres} a las {cancelar.hora}?</p>}
        {cancelar?.adelantoPagado && (
          <div className="mt-3">
            <p className="small mb-2">Pagó un adelanto de <strong>{solesPE(cancelar.adelantoPagado)}</strong>.</p>
            <div className="form-check">
              <input id="por-clinica" type="checkbox" className="form-check-input" checked={porClinica} onChange={(e) => setPorClinica(e.target.checked)} />
              <label htmlFor="por-clinica" className="form-check-label">La cancela la clínica (se devuelve el adelanto)</label>
            </div>
            {!porClinica && <p className="small text-muted mt-1 mb-0">Si la cancela el paciente: con 24 h o más queda como saldo a favor; con menos, lo pierde.</p>}
          </div>
        )}
      </ModalConfirmar>

      <ModalReprogramar cita={reprogramar} onCerrar={() => setReprogramar(null)} />
    </>
  );
}
