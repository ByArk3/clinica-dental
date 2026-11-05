import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ETIQUETA_BILLETERA, MENSAJES, rechazarPagoSchema } from '@clinica/shared';
import { cajaApi, type Comprobante, type ComprobanteDelDia, type PendienteCaja } from '../api/recursos';
import { ModalAnular } from '../components/ModalAnular';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { BotonAccion, BotonCopiar } from '../components/Interaccion';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import { fechaHoraPE, fechaPE, mensajeError, solesPE } from '../formato';

/** CU-13 (i_caja): cobrar citas atendidas y adelantos, verificar pagos reportados (Yape/Plin), emitir comprobante. */
export default function Caja() {
  const pendientes = useQuery({
    queryKey: ['caja-pendientes'],
    queryFn: cajaApi.pendientes,
    refetchInterval: 30_000,
  });
  const campanas = useQuery({
    queryKey: ['caja-campanas'],
    queryFn: cajaApi.campanas,
    staleTime: 5 * 60_000,
  });
  const [elegida, setElegida] = useState<PendienteCaja | null>(null);
  const [emitido, setEmitido] = useState<Comprobante | null>(null);
  const porVerificar = pendientes.data?.filter((p) => p.estado === 'pago_en_verificacion').length ?? 0;

  const elegir = (p: PendienteCaja) => {
    setEmitido(null);
    setElegida(p);
  };

  return (
    <>
      <h1 className="h4 mb-3">Caja</h1>
      {!!campanas.data?.length && (
        <div className="alert alert-info small py-2">
          Campañas vigentes hoy (se aplican solas según la fecha de la cita):{' '}
          {campanas.data
            .map((c) => `${c.nombre}${c.porcentaje ? ` (${Number(c.porcentaje)} %)` : ' (3x2)'}`)
            .join(' · ')}
        </div>
      )}
      <div className="row g-3">
        <div className="col-lg-5">
          <h2 className="h6 text-uppercase text-muted">
            Por cobrar{' '}
            {porVerificar > 0 && (
              <span className="badge text-bg-primary ms-1">{porVerificar} pago(s) por verificar</span>
            )}
          </h2>
          {pendientes.isLoading && <p className="text-muted">Cargando…</p>}
          {pendientes.data?.length === 0 && (
            <div className="tarjeta text-muted">No hay cobros pendientes.</div>
          )}
          <div className="list-group">
            {pendientes.data?.map((p) => (
              <OverlayTrigger
                key={p.citaId}
                placement="right"
                trigger={['hover', 'focus']}
                delay={{ show: 350, hide: 0 }}
                overlay={
                  <Popover>
                    <Popover.Body className="small">
                      <div>
                        <strong>
                          {p.paciente.nombres} {p.paciente.apellidos}
                        </strong>{' '}
                        · DNI {p.paciente.dni}
                      </div>
                      <div>
                        {p.tipo === 'adelanto'
                          ? `Adelanto${p.tratamientoPrevisto ? ` de ${p.tratamientoPrevisto}` : ''}`
                          : 'Cobro de servicio'}
                        : {solesPE(p.importe)}
                      </div>
                      {Number(p.saldoFavor) > 0 && (
                        <div className="text-success">Saldo a favor: {solesPE(p.saldoFavor)}</div>
                      )}
                      {p.pagoReportado && (
                        <div>
                          Reportó {ETIQUETA_BILLETERA[p.pagoReportado.metodo]} · op.{' '}
                          {p.pagoReportado.numeroOperacion}
                        </div>
                      )}
                    </Popover.Body>
                  </Popover>
                }
              >
                <button
                  type="button"
                  className={`list-group-item list-group-item-action aparece ${elegida?.citaId === p.citaId ? 'active' : ''}`}
                  onClick={() => elegir(p)}
                >
                  <div className="d-flex justify-content-between gap-2">
                    <strong>
                      {p.paciente.nombres} {p.paciente.apellidos}
                    </strong>
                    <span className="text-nowrap">{solesPE(p.importe)}</span>
                  </div>
                  <div className="small">
                    {p.estado === 'pago_en_verificacion' ? (
                      <span className="badge text-bg-primary me-1">
                        Verificar {ETIQUETA_BILLETERA[p.pagoReportado?.metodo ?? 'yape']}
                      </span>
                    ) : p.tipo === 'adelanto' ? (
                      <span className="badge text-bg-warning me-1">Adelanto</span>
                    ) : (
                      <span className="badge text-bg-info me-1">Servicio</span>
                    )}
                    {fechaPE(p.fecha)} {p.hora} · {p.odontologo}
                  </div>
                </button>
              </OverlayTrigger>
            ))}
          </div>
          <ComprobantesDeHoy />
        </div>
        <div className="col-lg-7">
          {emitido ? (
            <ComprobanteEmitido
              c={emitido}
              onSiguiente={() => {
                setEmitido(null);
                setElegida(null);
              }}
            />
          ) : elegida ? (
            <Cobro
              key={elegida.citaId}
              pendiente={elegida}
              onEmitido={setEmitido}
              onCerrado={() => setElegida(null)}
            />
          ) : (
            <div className="tarjeta text-muted">Seleccione una cita para cobrar.</div>
          )}
        </div>
      </div>
    </>
  );
}

function Cobro({
  pendiente,
  onEmitido,
  onCerrado,
}: {
  pendiente: PendienteCaja;
  onEmitido: (c: Comprobante) => void;
  onCerrado: () => void;
}) {
  const qc = useQueryClient();
  const [tipoPagoId, setTipoPagoId] = useState<number | undefined>();
  const [monto, setMonto] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [rechazar, setRechazar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errMotivo, setErrMotivo] = useState<string | null>(null);

  const importe = useQuery({
    queryKey: ['importe', pendiente.citaId],
    queryFn: () => cajaApi.importe(pendiente.citaId),
  });
  const tipos = useQuery({ queryKey: ['tipos-pago'], queryFn: cajaApi.tiposPago, staleTime: Infinity });

  const efectivo = tipos.data?.find((t) => t.id === tipoPagoId)?.nombre.toLowerCase() === 'efectivo';
  const total = Number(importe.data?.total ?? 0);
  const recibido = Number(monto.replace(',', '.'));
  const vuelto = efectivo && monto !== '' && recibido >= total ? recibido - total : null;
  const listo = (c: Comprobante) => {
    qc.invalidateQueries({ queryKey: ['caja-pendientes'] });
    qc.invalidateQueries({ queryKey: ['caja-comprobantes'] });
    onEmitido(c);
  };

  const emitir = useMutation({
    mutationFn: () =>
      cajaApi.emitir(pendiente.citaId, {
        tipoPagoId: tipoPagoId!,
        montoRecibido: efectivo ? recibido : undefined,
      }),
    onSuccess: listo,
  });
  const aprobar = useMutation({ mutationFn: () => cajaApi.aprobarPago(pendiente.citaId), onSuccess: listo });
  const rechazo = useMutation({
    mutationFn: () => cajaApi.rechazarPago(pendiente.citaId, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-pendientes'] });
      setRechazar(false);
      onCerrado();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const c: Record<string, string> = {};
    if (!tipoPagoId) c.tipoPagoId = 'Elija un tipo de pago';
    if (efectivo && (monto === '' || Number.isNaN(recibido))) c.montoRecibido = 'Ingrese el monto recibido';
    else if (efectivo && recibido < total) c.montoRecibido = MENSAJES.MONTO_INSUFICIENTE; // 6.1
    setErrores(c);
    if (Object.keys(c).length === 0) emitir.mutate();
  }

  if (importe.isError)
    return (
      <div className="alert alert-danger" role="alert">
        {mensajeError(importe.error)}
      </div>
    );
  if (!importe.data) return <p className="text-muted">Calculando importe…</p>;
  const imp = importe.data;
  const reportado = imp.pagoReportado;

  return (
    <form className="tarjeta" onSubmit={enviar} noValidate>
      <h2 className="h5 mb-1">
        {reportado
          ? 'Verificar pago de adelanto'
          : imp.tipo === 'adelanto'
            ? 'Cobro de adelanto'
            : 'Cobro de servicio'}
      </h2>
      <p className="small text-muted">
        {imp.paciente.nombres} {imp.paciente.apellidos} · DNI {imp.paciente.dni}
        {Number(pendiente.saldoFavor) > 0 && (
          <>
            {' '}
            · <span className="text-success">saldo a favor {solesPE(pendiente.saldoFavor)}</span>
          </>
        )}
      </p>
      {imp.tipo === 'adelanto' && !reportado && (
        <div className="alert alert-warning small py-2">
          Adelanto del 50 % ({pendiente.tratamientoPrevisto ?? 'consulta'}). Al pagarlo la cita queda
          confirmada.
          {pendiente.adelantoVenceEn && <> Vence a las {fechaHoraPE(pendiente.adelantoVenceEn).slice(-5)}.</>}
        </div>
      )}

      <table className="table table-sm">
        <tbody>
          {imp.lineas.map((l, i) => (
            <tr key={i}>
              <td>
                {l.descripcion}
                {l.campana && (
                  <div className="small text-success">
                    {l.campana}: − {solesPE(l.descuento)}
                  </div>
                )}
              </td>
              <td className="text-end text-nowrap">{solesPE(l.precio)}</td>
            </tr>
          ))}
          <tr className="border-top">
            <td>Subtotal</td>
            <td className="text-end">{solesPE(imp.subtotal)}</td>
          </tr>
          {Number(imp.descuento) > 0 && (
            <tr>
              <td>Descuentos de campaña</td>
              <td className="text-end text-success">− {solesPE(imp.descuento)}</td>
            </tr>
          )}
          {Number(imp.adelantoAplicado) > 0 && (
            <tr>
              <td>Adelanto pagado</td>
              <td className="text-end text-success">− {solesPE(imp.adelantoAplicado)}</td>
            </tr>
          )}
          {Number(imp.saldoAplicado) > 0 && (
            <tr>
              <td>Saldo a favor</td>
              <td className="text-end text-success">− {solesPE(imp.saldoAplicado)}</td>
            </tr>
          )}
          <tr className="fs-5">
            <th>Total</th>
            <th className="text-end text-nowrap" data-testid="total">
              {solesPE(imp.total)}
            </th>
          </tr>
        </tbody>
      </table>
      {Number(imp.sobrante) > 0 && (
        <div className="alert alert-success small py-2">
          El adelanto supera el cobro: {solesPE(imp.sobrante)} quedarán como saldo a favor del paciente.
        </div>
      )}

      {reportado ? (
        <>
          <div className="border rounded p-2 mb-3 small">
            Reportó <strong>{ETIQUETA_BILLETERA[reportado.metodo]}</strong> · operación{' '}
            <strong>{reportado.numeroOperacion}</strong>
            <BotonCopiar texto={reportado.numeroOperacion} etiqueta="el número de operación" /> ·{' '}
            {fechaHoraPE(reportado.reportadoEn)}
            {reportado.tieneCaptura && (
              <>
                {' '}
                ·{' '}
                <a href={cajaApi.capturaUrl(pendiente.citaId)} target="_blank" rel="noreferrer">
                  Ver captura
                </a>
              </>
            )}
            <div className="text-muted">
              Revise en el celular de la clínica que llegó ese pago antes de aprobar.
            </div>
          </div>
          {(aprobar.isError || rechazo.isError) && (
            <div className="alert alert-danger" role="alert">
              {mensajeError(aprobar.error ?? rechazo.error)}
            </div>
          )}
          <div className="d-flex gap-2">
            <BotonAccion
              type="button"
              className="btn btn-acento flex-grow-1"
              mutacion={aprobar}
              textoPendiente="Emitiendo…"
              onClick={() => aprobar.mutate()}
            >
              Aprobar pago y emitir comprobante
            </BotonAccion>
            <button type="button" className="btn btn-outline-danger" onClick={() => setRechazar(true)}>
              Rechazar
            </button>
          </div>
          <ModalConfirmar
            abierto={rechazar}
            titulo="Rechazar pago"
            textoConfirmar="Rechazar y liberar el horario"
            peligro
            procesando={rechazo.isPending}
            error={errMotivo ?? (rechazo.isError ? mensajeError(rechazo.error) : null)}
            onConfirmar={() => {
              const v = rechazarPagoSchema.safeParse({ motivo });
              if (!v.success) return setErrMotivo(v.error.issues[0].message);
              setErrMotivo(null);
              rechazo.mutate();
            }}
            onCerrar={() => setRechazar(false)}
          >
            <label htmlFor="motivo-rechazo" className="form-label">
              Motivo (se le enviará al paciente)
            </label>
            <input
              id="motivo-rechazo"
              className="form-control"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: no llegó ningún pago con ese número"
            />
          </ModalConfirmar>
        </>
      ) : (
        <>
          <span className="form-label d-block">Tipo de pago</span>
          <div className="d-flex flex-wrap gap-2 mb-1" role="radiogroup" aria-label="Tipo de pago">
            {tipos.data?.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tipoPagoId === t.id}
                className={`btn ${tipoPagoId === t.id ? 'btn-acento' : 'btn-outline-secondary'}`}
                onClick={() => setTipoPagoId(t.id)}
              >
                {t.nombre}
              </button>
            ))}
          </div>
          {errores.tipoPagoId && <div className="text-danger small">{errores.tipoPagoId}</div>}
          {efectivo && (
            <div className="row g-2 mt-2 align-items-end">
              <div className="col-6">
                <label htmlFor="monto" className="form-label">
                  Monto recibido (S/)
                </label>
                <input
                  id="monto"
                  inputMode="decimal"
                  className={`form-control ${errores.montoRecibido ? 'is-invalid' : ''}`}
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                />
                <div className="invalid-feedback">{errores.montoRecibido}</div>
              </div>
              <div className="col-6">
                <span className="form-label d-block">Vuelto</span>
                <div className="fs-5 fw-semibold" data-testid="vuelto">
                  {vuelto !== null ? solesPE(vuelto) : '—'}
                </div>
              </div>
            </div>
          )}
          {emitir.isError && (
            <div className="alert alert-danger mt-3" role="alert">
              {mensajeError(emitir.error)}
            </div>
          )}
          <BotonAccion
            type="submit"
            className="btn btn-acento w-100 mt-3"
            mutacion={emitir}
            textoPendiente="Emitiendo…"
          >
            {`Emitir comprobante por ${solesPE(imp.total)}`}
          </BotonAccion>
        </>
      )}
    </form>
  );
}

function ComprobanteEmitido({ c, onSiguiente }: { c: Comprobante; onSiguiente: () => void }) {
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});
  const [enviado, setEnviado] = useState(c.enviadoEmail);
  const imprimir = useMutation({
    mutationFn: () => cajaApi.pdf(c.id),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setEstado({});
    },
    onError: () => setEstado({ error: MENSAJES.ERROR_PDF }), // 10.1
  });
  const correo = useMutation({
    mutationFn: () => cajaApi.enviar(c.id),
    onSuccess: (r) => {
      setEnviado(true);
      setEstado({ ok: r.mensaje });
    },
    onError: (e) => setEstado({ error: mensajeError(e) }),
  });

  return (
    <div className="tarjeta">
      <h2 className="h5">Comprobante {c.numero} emitido</h2>
      <p className="mb-1">
        {c.paciente.nombres} {c.paciente.apellidos} · {c.tipoPago}
        {c.operacion && ` (op. ${c.operacion})`}
      </p>
      <p className="fs-5 mb-1">
        Total: <strong>{solesPE(c.total)}</strong>
      </p>
      {Number(c.vuelto) > 0 && (
        <p className="fs-5">
          Vuelto: <strong>{solesPE(c.vuelto)}</strong>
        </p>
      )}
      {c.tipo === 'adelanto' && <p className="small text-muted">La cita quedó «Confirmada».</p>}
      {Number(c.saldoGenerado) > 0 && (
        <p className="small text-success">
          {solesPE(c.saldoGenerado)} quedaron como saldo a favor (saldo actual:{' '}
          {solesPE(c.paciente.saldoFavor)}).
        </p>
      )}
      <div className="d-flex flex-wrap gap-2 mt-3">
        <button
          className="btn btn-outline-secondary"
          onClick={() => imprimir.mutate()}
          disabled={imprimir.isPending}
        >
          {imprimir.isError ? 'Reintentar impresión' : 'Imprimir (PDF)'}
        </button>
        <button
          className="btn btn-outline-secondary"
          disabled={!c.paciente.tieneCorreo || correo.isPending}
          title={c.paciente.tieneCorreo ? undefined : MENSAJES.PACIENTE_SIN_CORREO}
          onClick={() => correo.mutate()}
        >
          {enviado ? 'Reenviar por correo' : 'Enviar por correo'}
        </button>
        <button className="btn btn-acento ms-auto" onClick={onSiguiente}>
          Siguiente cobro
        </button>
      </div>
      {!c.paciente.tieneCorreo && (
        <p className="small text-muted mt-2 mb-0">{MENSAJES.PACIENTE_SIN_CORREO}.</p>
      )}
      {estado.ok && <div className="alert alert-success mt-3 mb-0">{estado.ok}</div>}
      {estado.error && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          {estado.error}
        </div>
      )}
    </div>
  );
}

/** Comprobantes emitidos hoy: ver PDF y anular los emitidos por error. */
function ComprobantesDeHoy() {
  const lista = useQuery({
    queryKey: ['caja-comprobantes'],
    queryFn: () => cajaApi.delDia(),
    refetchInterval: 60_000,
  });
  const [anular, setAnular] = useState<ComprobanteDelDia | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const abrirPdf = async (id: number) => {
    try {
      const url = URL.createObjectURL(await cajaApi.pdf(id));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setAviso(null);
      window.alert(MENSAJES.ERROR_PDF);
    }
  };
  return (
    <section className="mt-4">
      <h2 className="h6 text-uppercase text-muted">Comprobantes de hoy</h2>
      {aviso && <div className="alert alert-success py-2 small">{aviso}</div>}
      {lista.data?.length === 0 && (
        <div className="tarjeta text-muted small">Aún no se emitieron comprobantes hoy.</div>
      )}
      <div className="list-group">
        {lista.data?.map((c) => (
          <div key={c.id} className={`list-group-item ${c.anulado ? 'text-muted' : ''}`}>
            <div className="d-flex justify-content-between gap-2">
              <span>
                <strong className={c.anulado ? 'text-decoration-line-through' : ''}>{c.numero}</strong>
                {c.tipo === 'adelanto' && <span className="badge text-bg-warning ms-1">Adelanto</span>}
                {c.anulado && <span className="badge text-bg-danger ms-1">Anulado</span>}
              </span>
              <span className={`text-nowrap ${c.anulado ? 'text-decoration-line-through' : ''}`}>
                {solesPE(c.total)}
              </span>
            </div>
            <div className="small">
              {c.paciente} · {c.tipoPago}
            </div>
            {c.anulado && (
              <div className="small">
                Anulado por {c.anulado.por}: {c.anulado.motivo}
              </div>
            )}
            <div className="mt-1">
              <button type="button" className="btn btn-link btn-sm p-0 me-3" onClick={() => abrirPdf(c.id)}>
                Ver PDF
              </button>
              {c.puedeAnular && (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-danger"
                  onClick={() => {
                    setAviso(null);
                    setAnular(c);
                  }}
                >
                  Anular
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <ModalAnular
        comprobante={anular}
        onCerrar={() => setAnular(null)}
        onAnulado={(c) =>
          setAviso(
            `${c.numero} anulado. ${c.tipo === 'servicio' ? 'La cita volvió a «Por cobrar».' : c.estadoCita === 'pendiente_adelanto' ? 'La cita volvió a «Pendiente de adelanto».' : ''}`,
          )
        }
      />
    </section>
  );
}
