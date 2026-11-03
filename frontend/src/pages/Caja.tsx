import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MENSAJES } from '@clinica/shared';
import { cajaApi, type Comprobante, type PendienteCaja } from '../api/recursos';
import { fechaPE, mensajeError, solesPE } from '../formato';

/** CU-13 (i_caja): cobrar citas atendidas y adelantos (RN-12), emitir comprobante, imprimir o enviar. */
export default function Caja() {
  const pendientes = useQuery({ queryKey: ['caja-pendientes'], queryFn: cajaApi.pendientes, refetchInterval: 30_000 });
  const [elegida, setElegida] = useState<PendienteCaja | null>(null);
  const [emitido, setEmitido] = useState<Comprobante | null>(null);

  const elegir = (p: PendienteCaja) => {
    setEmitido(null);
    setElegida(p);
  };

  return (
    <>
      <h1 className="h4 mb-3">Caja</h1>
      <div className="row g-3">
        <div className="col-lg-5">
          <h2 className="h6 text-uppercase text-muted">Por cobrar</h2>
          {pendientes.isLoading && <p className="text-muted">Cargando…</p>}
          {pendientes.data?.length === 0 && <div className="tarjeta text-muted">No hay cobros pendientes.</div>}
          <div className="list-group">
            {pendientes.data?.map((p) => (
              <button
                key={p.citaId}
                type="button"
                className={`list-group-item list-group-item-action ${elegida?.citaId === p.citaId ? 'active' : ''}`}
                onClick={() => elegir(p)}
              >
                <div className="d-flex justify-content-between gap-2">
                  <strong>{p.paciente.nombres} {p.paciente.apellidos}</strong>
                  <span className="text-nowrap">{solesPE(p.importe)}</span>
                </div>
                <div className="small">
                  {p.tipo === 'adelanto' ? <span className="badge text-bg-warning me-1">Adelanto</span> : <span className="badge text-bg-info me-1">Servicio</span>}
                  {fechaPE(p.fecha)} {p.hora} · {p.odontologo}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="col-lg-7">
          {emitido ? (
            <ComprobanteEmitido c={emitido} onSiguiente={() => { setEmitido(null); setElegida(null); }} />
          ) : elegida ? (
            <Cobro key={elegida.citaId} pendiente={elegida} onEmitido={setEmitido} />
          ) : (
            <div className="tarjeta text-muted">Seleccione una cita para cobrar.</div>
          )}
        </div>
      </div>
    </>
  );
}

function Cobro({ pendiente, onEmitido }: { pendiente: PendienteCaja; onEmitido: (c: Comprobante) => void }) {
  const qc = useQueryClient();
  const [descuentoId, setDescuentoId] = useState<number | undefined>();
  const [tipoPagoId, setTipoPagoId] = useState<number | undefined>();
  const [monto, setMonto] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});

  const importe = useQuery({ queryKey: ['importe', pendiente.citaId, descuentoId], queryFn: () => cajaApi.importe(pendiente.citaId, descuentoId), placeholderData: (prev) => prev });
  const tipos = useQuery({ queryKey: ['tipos-pago'], queryFn: cajaApi.tiposPago, staleTime: Infinity });
  const descuentos = useQuery({ queryKey: ['descuentos'], queryFn: cajaApi.descuentos, enabled: pendiente.tipo === 'servicio' });

  const efectivo = tipos.data?.find((t) => t.id === tipoPagoId)?.nombre.toLowerCase() === 'efectivo';
  const total = Number(importe.data?.total ?? 0);
  const recibido = Number(monto.replace(',', '.'));
  const vuelto = efectivo && monto !== '' && recibido >= total ? recibido - total : null;

  const emitir = useMutation({
    mutationFn: () => cajaApi.emitir(pendiente.citaId, { tipoPagoId: tipoPagoId!, montoRecibido: efectivo ? recibido : undefined, descuentoId: descuentoId ?? null }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['caja-pendientes'] });
      onEmitido(c);
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

  if (importe.isError) return <div className="alert alert-danger" role="alert">{mensajeError(importe.error)}</div>;
  if (!importe.data) return <p className="text-muted">Calculando importe…</p>;
  const imp = importe.data;

  return (
    <form className="tarjeta" onSubmit={enviar} noValidate>
      <h2 className="h5 mb-1">{imp.tipo === 'adelanto' ? 'Cobro de adelanto' : 'Cobro de servicio'}</h2>
      <p className="small text-muted">{imp.paciente.nombres} {imp.paciente.apellidos} · DNI {imp.paciente.dni}</p>
      {imp.tipo === 'adelanto' && (
        <div className="alert alert-warning small py-2">El paciente tiene 3 o más inasistencias (RN-12). Al pagar el adelanto, su cita sigue el flujo normal de confirmación.</div>
      )}

      <table className="table table-sm">
        <tbody>
          {imp.lineas.map((l, i) => (
            <tr key={i}><td>{l.descripcion}</td><td className="text-end text-nowrap">{solesPE(l.precio)}</td></tr>
          ))}
          <tr className="border-top"><td>Subtotal</td><td className="text-end">{solesPE(imp.subtotal)}</td></tr>
          {Number(imp.descuento) > 0 && <tr><td>Descuento ({imp.descuentoAplicado?.nombre})</td><td className="text-end text-success">− {solesPE(imp.descuento)}</td></tr>}
          {Number(imp.adelantoAplicado) > 0 && <tr><td>Adelanto pagado</td><td className="text-end text-success">− {solesPE(imp.adelantoAplicado)}</td></tr>}
          <tr className="fs-5"><th>Total</th><th className="text-end" data-testid="total">{solesPE(imp.total)}</th></tr>
        </tbody>
      </table>

      {imp.tipo === 'servicio' && !!descuentos.data?.length && (
        <div className="mb-3">
          <label htmlFor="descuento" className="form-label">Descuento</label>
          <select id="descuento" className="form-select" value={descuentoId ?? ''} onChange={(e) => setDescuentoId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Sin descuento</option>
            {descuentos.data.map((d) => <option key={d.id} value={d.id}>{d.nombre} ({Number(d.porcentaje)} %)</option>)}
          </select>
        </div>
      )}

      <span className="form-label d-block">Tipo de pago</span>
      <div className="d-flex flex-wrap gap-2 mb-1" role="radiogroup" aria-label="Tipo de pago">
        {tipos.data?.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={tipoPagoId === t.id} className={`btn ${tipoPagoId === t.id ? 'btn-acento' : 'btn-outline-secondary'}`} onClick={() => setTipoPagoId(t.id)}>
            {t.nombre}
          </button>
        ))}
      </div>
      {errores.tipoPagoId && <div className="text-danger small">{errores.tipoPagoId}</div>}

      {efectivo && (
        <div className="row g-2 mt-2 align-items-end">
          <div className="col-6">
            <label htmlFor="monto" className="form-label">Monto recibido (S/)</label>
            <input id="monto" inputMode="decimal" className={`form-control ${errores.montoRecibido ? 'is-invalid' : ''}`} value={monto} onChange={(e) => setMonto(e.target.value)} />
            <div className="invalid-feedback">{errores.montoRecibido}</div>
          </div>
          <div className="col-6">
            <span className="form-label d-block">Vuelto</span>
            <div className="fs-5 fw-semibold" data-testid="vuelto">{vuelto !== null ? solesPE(vuelto) : '—'}</div>
          </div>
        </div>
      )}

      {emitir.isError && <div className="alert alert-danger mt-3" role="alert">{mensajeError(emitir.error)}</div>}
      <button type="submit" className="btn btn-acento w-100 mt-3" disabled={emitir.isPending}>
        {emitir.isPending ? 'Emitiendo…' : `Emitir comprobante por ${solesPE(imp.total)}`}
      </button>
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
    onSuccess: (r) => { setEnviado(true); setEstado({ ok: r.mensaje }); },
    onError: (e) => setEstado({ error: mensajeError(e) }),
  });

  return (
    <div className="tarjeta">
      <h2 className="h5">Comprobante {c.numero} emitido</h2>
      <p className="mb-1">{c.paciente.nombres} {c.paciente.apellidos} · {c.tipoPago}</p>
      <p className="fs-5 mb-1">Total: <strong>{solesPE(c.total)}</strong></p>
      {Number(c.vuelto) > 0 && <p className="fs-5">Vuelto: <strong>{solesPE(c.vuelto)}</strong></p>}
      {c.tipo === 'adelanto' && <p className="small text-muted">La cita quedó «{c.estadoCita === 'confirmada' ? 'Confirmada' : 'Pendiente de confirmación'}».</p>}
      <div className="d-flex flex-wrap gap-2 mt-3">
        <button className="btn btn-outline-secondary" onClick={() => imprimir.mutate()} disabled={imprimir.isPending}>
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
        <button className="btn btn-acento ms-auto" onClick={onSiguiente}>Siguiente cobro</button>
      </div>
      {!c.paciente.tieneCorreo && <p className="small text-muted mt-2 mb-0">{MENSAJES.PACIENTE_SIN_CORREO}.</p>}
      {estado.ok && <div className="alert alert-success mt-3 mb-0">{estado.ok}</div>}
      {estado.error && <div className="alert alert-danger mt-3 mb-0" role="alert">{estado.error}</div>}
    </div>
  );
}
