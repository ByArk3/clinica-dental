import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ETIQUETA_BILLETERA, LARGO_NUMERICO, reportarPagoSchema, soloDigitos, type Billetera, type ReportarPagoDTO } from '@clinica/shared';
import { Modal } from 'react-bootstrap';
import { BotonAccion, BotonCopiar } from './Interaccion';
import { citasApi, type Cita } from '../api/recursos';
import { erroresZod, mensajeError, solesPE } from '../formato';

const MAX_BYTES = 2 * 1024 * 1024;
const horaLima = (iso: string) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function useMinutosRestantes(iso: string | null) {
  const calc = () => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000)) : null);
  const [m, setM] = useState(calc);
  useEffect(() => {
    const t = setInterval(() => setM(calc()), 15_000);
    return () => clearInterval(t);
  }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  return m;
}

/**
 * Adelanto (50 % del tratamiento previsto, plazo de 1 hora).
 * Web: el paciente paga por Yape/Plin y reporta el N.° de operación (y una captura opcional) → «Pago en verificación».
 * Presencial: la recepcionista lo cobra en Caja en ese momento.
 */
export function PanelPagoAdelanto({ cita, modo, onReportado }: { cita: Cita; modo: 'web' | 'presencial'; onReportado?: (c: Cita) => void }) {
  const qc = useQueryClient();
  const datos = useQuery({ queryKey: ['datos-pago'], queryFn: citasApi.datosPago, staleTime: 5 * 60_000 });
  const minutos = useMinutosRestantes(cita.adelantoVenceEn);
  const billeteras: Billetera[] = datos.data?.billeteras ?? ['yape'];
  const [elegido, setMetodo] = useState<Billetera>('yape');
  // Si la clínica acepta una sola billetera, no se pregunta
  const metodo: Billetera = billeteras.includes(elegido) ? elegido : billeteras[0];
  const nombres = billeteras.map((b) => ETIQUETA_BILLETERA[b]).join(' o ');
  const aPagar = cita.aPagar ?? cita.montoAdelanto ?? '0';
  const [numero, setNumero] = useState('');
  const [captura, setCaptura] = useState<string | undefined>();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState<ReportarPagoDTO | null>(null);
  const [qrGrande, setQrGrande] = useState(false);
  const reportar = useMutation({
    mutationFn: (d: Parameters<typeof citasApi.reportarPago>[1]) => citasApi.reportarPago(cita.id, d),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['mis-citas'] });
      setConfirmar(null);
      onReportado?.(c);
    },
  });

  function elegirArchivo(f: File | undefined) {
    setCaptura(undefined);
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setErrores({ captura: 'La captura debe ser una imagen PNG, JPG o WEBP' });
    if (f.size > MAX_BYTES) return setErrores({ captura: 'La captura no debe pasar de 2 MB' });
    setErrores({});
    const lector = new FileReader();
    lector.onload = () => setCaptura(String(lector.result));
    lector.readAsDataURL(f);
  }
  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = reportarPagoSchema.safeParse({ metodo, numeroOperacion: numero, captura });
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    setConfirmar(r.data); // antes de enviar, el paciente revisa el resumen
  }

  if (cita.estado === 'pago_en_verificacion') {
    return (
      <div className="alert alert-info mb-0" role="status">
        Recibimos su reporte de pago ({ETIQUETA_BILLETERA[cita.pagoReportado?.metodo ?? 'yape']}, operación {cita.pagoReportado?.numeroOperacion}). La clínica lo verificará y su cita quedará confirmada.
      </div>
    );
  }

  return (
    <div className="border rounded p-3 bg-body-tertiary" data-testid="panel-adelanto">
      <div className="d-flex flex-wrap justify-content-between gap-2">
        <strong>Adelanto: {solesPE(cita.montoAdelanto ?? 0)}</strong>
        {cita.adelantoVenceEn && (
          <span className={`small ${minutos !== null && minutos <= 15 ? 'text-danger-emphasis fw-semibold' : 'text-muted'}`}>
            Pagar hasta las {horaLima(cita.adelantoVenceEn)}{minutos !== null && ` (quedan ${minutos} min)`}
          </span>
        )}
      </div>
      <p className="small text-muted mb-2">
        Adelanto de {cita.tratamientoPrevisto ?? 'la consulta'}. Si no se paga en 1 hora, el horario se libera. Se descuenta del cobro final; si sobra, queda como saldo a favor
        {datos.data && (datos.data.saldoVigenciaMeses > 0 ? ` por ${datos.data.saldoVigenciaMeses} meses` : '')}.
      </p>
      {cita.saldoAplicable && (
        <div className="alert alert-success py-2 small mb-2" role="status">
          Su saldo a favor cubre <strong>{solesPE(cita.saldoAplicable)}</strong>: solo debe pagar <strong>{solesPE(aPagar)}</strong>.
        </div>
      )}
      {modo === 'presencial' ? (
        <Link to="/caja" className="btn btn-acento btn-sm">Cobrar ahora en Caja</Link>
      ) : (
        <form onSubmit={enviar} noValidate>
          <div className="d-flex flex-wrap gap-3 align-items-start mb-2">
            {datos.data?.tieneQr && (
              <div className="text-center">
                <button type="button" className="btn p-0 border-0 bg-transparent" onClick={() => setQrGrande(true)} aria-label="Ampliar el QR">
                  <img src={citasApi.qrUrl()} alt={`QR de ${nombres} de la clínica`} className="qr-miniatura border rounded bg-white p-1" style={{ width: 160, height: 160, objectFit: 'contain' }} />
                </button>
                <div className="small text-muted">🔍 Toca el QR para ampliarlo</div>
              </div>
            )}
            <p className="mb-0" style={{ flex: '1 1 200px' }}>
              {datos.data?.tieneQr ? `Escanee el QR con ${nombres} o pague` : `Pague por ${nombres}`} al <strong>{datos.data?.numero ?? '…'}</strong>
              {datos.data?.numero && <BotonCopiar texto={datos.data.numero} etiqueta="el número" />} a nombre de{' '}
              <strong>{datos.data?.titular ?? '…'}</strong> el monto de <strong>{solesPE(aPagar)}</strong>. Luego registre aquí su pago:
            </p>
          </div>
          {billeteras.length > 1 && (
            <div className="btn-group mb-2" role="radiogroup" aria-label="Medio de pago">
              {billeteras.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={metodo === m} className={`btn btn-sm ${metodo === m ? 'btn-acento' : 'btn-outline-secondary'}`} onClick={() => setMetodo(m)}>
                  {ETIQUETA_BILLETERA[m]}
                </button>
              ))}
            </div>
          )}
          <div className="mb-2">
            <label htmlFor={`op-${cita.id}`} className="form-label small mb-1">Número de operación</label>
            <input id={`op-${cita.id}`} className={`form-control ${errores.numeroOperacion ? 'is-invalid' : ''}`} value={numero} onChange={(e) => setNumero(soloDigitos(e.target.value, LARGO_NUMERICO.operacion))} inputMode="numeric" maxLength={LARGO_NUMERICO.operacion} />
            <div className="invalid-feedback">{errores.numeroOperacion}</div>
          </div>
          <div className="mb-2">
            <label htmlFor={`cap-${cita.id}`} className="form-label small mb-1">Captura del pago (opcional, máx. 2 MB)</label>
            <input id={`cap-${cita.id}`} type="file" accept="image/png,image/jpeg,image/webp" className={`form-control form-control-sm ${errores.captura ? 'is-invalid' : ''}`} onChange={(e) => elegirArchivo(e.target.files?.[0])} />
            <div className="invalid-feedback">{errores.captura}</div>
          </div>
          <div className="accion-fija">
            <button className="btn btn-acento btn-sm">Ya pagué: registrar mi pago</button>
          </div>
        </form>
      )}

      {/* QR ampliado */}
      <Modal show={qrGrande} onHide={() => setQrGrande(false)} centered className="qr-ampliado" backdropClassName="qr-fondo">
        <Modal.Body className="text-center p-2">
          <button type="button" className="cerrar-qr" aria-label="Cerrar" onClick={() => setQrGrande(false)}>✕</button>
          <img src={citasApi.qrUrl()} alt={`QR de ${nombres} de la clínica (ampliado)`} className="bg-white rounded p-2 w-100" style={{ maxHeight: '75vh', objectFit: 'contain' }} />
          <div className="text-white mt-2 d-inline-block rounded px-3 py-1" style={{ background: 'rgba(0, 0, 0, 0.6)' }}>
            {nombres} al <strong>{datos.data?.numero}</strong> · <strong>{solesPE(aPagar)}</strong>
            <div className="small opacity-75">Toque fuera de la imagen o la ✕ para cerrar</div>
          </div>
        </Modal.Body>
      </Modal>

      {/* Confirmar antes de registrar el pago */}
      <Modal show={!!confirmar} onHide={() => !reportar.isPending && setConfirmar(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h5">¿Ya realizó el pago?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">Revise que estos datos coincidan con lo que le muestra {ETIQUETA_BILLETERA[metodo]}:</p>
          <table className="table table-sm mb-3">
            <tbody>
              <tr><th className="fw-normal text-muted w-50">Monto</th><td className="fw-semibold">{solesPE(aPagar)}</td></tr>
              <tr><th className="fw-normal text-muted">{ETIQUETA_BILLETERA[metodo]} al</th><td>{datos.data?.numero} · {datos.data?.titular}</td></tr>
              <tr><th className="fw-normal text-muted">N.° de operación</th><td className="fw-semibold">{confirmar?.numeroOperacion}</td></tr>
              <tr><th className="fw-normal text-muted">Captura</th><td>{confirmar?.captura ? 'Adjunta ✓' : <span className="text-muted">Sin captura</span>}</td></tr>
            </tbody>
          </table>
          <div className="alert alert-warning py-2 mb-0 small">⚠ La clínica verificará que el pago haya llegado. Si no llega, la cita se cancela y el horario se libera.</div>
          {reportar.isError && <div className="alert alert-danger py-2 mt-2 mb-0" role="alert">{mensajeError(reportar.error)}</div>}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" disabled={reportar.isPending} onClick={() => setConfirmar(null)}>Volver y revisar</button>
          <BotonAccion type="button" mutacion={reportar} textoPendiente="Enviando…" onClick={() => confirmar && reportar.mutate(confirmar)}>Sí, ya pagué</BotonAccion>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
