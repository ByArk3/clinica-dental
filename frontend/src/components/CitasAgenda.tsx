import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ESTADOS_MODIFICABLES } from '@clinica/shared';
import { citasApi, type CitaDelDia } from '../api/recursos';
import { ChipEstado } from './ChipEstado';
import { ModalConfirmar } from './ModalConfirmar';
import { ModalReprogramar } from './ModalReprogramar';
import { ModalEditarDatos } from './ModalEditarDatos';
import { DniPaciente } from './DniPaciente';
import { diaSemanaPE, fechaPE, horasPara, mensajeError, solesPE } from '../formato';

/**
 * Tarjetas de citas con sus acciones para la recepcionista (CU-07, CU-09, CU-58): inasistencia, reprogramar, cancelar,
 * cobrar adelanto, recordar por WhatsApp y editar datos. Las usan la Agenda (citas de una fecha) y Buscar cita (de un paciente).
 */
export function CitasAgenda({ citas, conFecha, mostrarPaciente = true, vacio }: { citas?: CitaDelDia[]; conFecha?: boolean; mostrarPaciente?: boolean; vacio?: ReactNode }) {
  const qc = useQueryClient();
  const [inasistencia, setInasistencia] = useState<CitaDelDia | null>(null);
  const [cancelar, setCancelar] = useState<CitaDelDia | null>(null);
  const [reprogramar, setReprogramar] = useState<CitaDelDia | null>(null);
  // «Editar cita» abre la pestaña de la cita; «Completar DNI», la del paciente
  const [editar, setEditar] = useState<{ cita: CitaDelDia; pestana: 'paciente' | 'cita' } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [porClinica, setPorClinica] = useState(false);

  const registrar = useMutation({
    mutationFn: (id: number) => citasApi.inasistencia(id),
    onSuccess: (r) => {
      setInasistencia(null);
      setAviso(r.aviso ?? null);
      qc.invalidateQueries({ predicate: (q) => ['citas-del-dia', 'citas-paciente'].includes(String(q.queryKey[0])) });
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
      qc.invalidateQueries({ predicate: (q) => ['citas-del-dia', 'citas-paciente'].includes(String(q.queryKey[0])) });
    },
  });

  return (
    <>
      {aviso && <div className="alert alert-warning alert-dismissible">{aviso}<button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} /></div>}
      {citas?.length === 0 && vacio}
      <div className="d-grid gap-2">
        {citas?.map((c) => {
          const modificable = ESTADOS_MODIFICABLES.includes(c.estado) && horasPara(c.fecha, c.hora) > 0;
          return (
            <div className="tarjeta py-3" key={c.id} data-testid={`cita-${c.id}`}>
              <div className="d-flex flex-wrap justify-content-between gap-2">
                <div>
                  <strong className="me-2">{conFecha ? `${diaSemanaPE(c.fecha).replace(/^./, (x) => x.toUpperCase())} ${fechaPE(c.fecha)} · ${c.hora}` : c.hora}</strong>
                  {mostrarPaciente ? (
                    <>
                      {c.paciente.nombres} {c.paciente.apellidos}
                      <span className="text-muted small"> · <DniPaciente dni={c.paciente.dni} /> · Cel. {c.paciente.telefono}</span>
                    </>
                  ) : (
                    c.odontologo
                  )}
                </div>
                <ChipEstado estado={c.estado} />
              </div>
              <div className="text-muted small">
                {mostrarPaciente ? `${c.odontologo} — ` : ''}
                {c.motivo} · {c.canal === 'web' ? 'Web' : 'Presencial'}
                {c.tratamientoPrevisto && !mostrarPaciente ? ` · previsto: ${c.tratamientoPrevisto}` : ''}
                {c.adelantoPagado ? ` · adelanto pagado ${solesPE(c.adelantoPagado)}` : ''}
                {c.pagoReportado ? ` · adelanto reportado por ${c.pagoReportado.metodo === 'yape' ? 'Yape' : 'Plin'} (op. ${c.pagoReportado.numeroOperacion})` : ''}
              </div>
              <div className="d-flex flex-wrap gap-2 mt-2">
                {c.estado === 'confirmada' && (
                  // desactivado hasta la hora de la cita; el aviso explica cuándo se activa (en un span: un botón desactivado no muestra el título)
                  <span className="d-inline-block" tabIndex={c.puedeRegistrarInasistencia ? undefined : 0} title={c.puedeRegistrarInasistencia ? undefined : `Se activa a las ${c.hora} del ${fechaPE(c.fecha)}, si el paciente no llega`}>
                    <button
                      className="btn btn-sm btn-outline-danger"
                      disabled={!c.puedeRegistrarInasistencia}
                      style={c.puedeRegistrarInasistencia ? undefined : { pointerEvents: 'none' }}
                      onClick={() => setInasistencia(c)}
                    >
                      Registrar inasistencia
                    </button>
                  </span>
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
                {c.estado === 'pago_en_verificacion' && <Link className="btn btn-sm btn-outline-primary" to="/caja">Verificar pago en Caja</Link>}
                {c.estado === 'atendida' && <Link className="btn btn-sm btn-outline-primary" to="/caja">Cobrar en Caja</Link>}
                {c.whatsapp && (
                  <a className="btn btn-sm btn-outline-success" href={c.whatsapp} target="_blank" rel="noreferrer">
                    Recordar por WhatsApp
                  </a>
                )}
                <button className="btn btn-sm btn-outline-primary" onClick={() => setEditar({ cita: c, pestana: 'cita' })}>Editar cita</button>
                {!c.paciente.dni && (
                  <button className="btn btn-sm btn-outline-warning" onClick={() => setEditar({ cita: c, pestana: 'paciente' })}>Completar DNI</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ModalEditarDatos pacienteId={editar?.cita.paciente.id ?? null} cita={editar?.cita} pestanaInicial={editar?.pestana} onCerrar={() => setEditar(null)} />

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
            <p className="small text-muted">
              Inasistencias actuales: {inasistencia.paciente.inasistencias}. Con 3, deberá pagar un adelanto para reservar.
            </p>
            <div className="alert alert-info small mb-0 py-2">
              Si el paciente <strong>avisó antes de la cita</strong> que no vendría, use <strong>Cancelar</strong>, no inasistencia.
            </div>
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
