import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ETIQUETA_ESTADO_PEDIDO, rangoFechasSchema, type EstadoPedido } from '@clinica/shared';
import { reportesApi } from '../api/recursos';
import { fechaHoraPE, fechaPE, hoyLima, mensajeError, numPE, solesPE } from '../formato';

/** CU-39 Reporte de ingresos · CU-40 Reporte de inventario. */
export default function Reportes() {
  const hoy = hoyLima();
  const [tab, setTab] = useState<'ingresos' | 'inventario'>('ingresos');
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const valido = rangoFechasSchema.safeParse({ desde, hasta });
  const ingresos = useQuery({ queryKey: ['rep-ingresos', desde, hasta], queryFn: () => reportesApi.ingresos(desde, hasta), enabled: tab === 'ingresos' && valido.success });
  const inventario = useQuery({ queryKey: ['rep-inventario', desde, hasta], queryFn: () => reportesApi.inventario(desde, hasta), enabled: tab === 'inventario' && valido.success });
  const error = ingresos.error ?? inventario.error;

  return (
    <>
      <h1 className="h4 mb-3">Reportes</h1>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item"><button className={`nav-link ${tab === 'ingresos' ? 'active' : ''}`} onClick={() => setTab('ingresos')}>Ingresos</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'inventario' ? 'active' : ''}`} onClick={() => setTab('inventario')}>Inventario</button></li>
      </ul>
      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <div><label htmlFor="r-desde" className="form-label small mb-1">Desde</label><input id="r-desde" type="date" className="form-control" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} /></div>
        <div><label htmlFor="r-hasta" className="form-label small mb-1">Hasta</label><input id="r-hasta" type="date" className="form-control" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} /></div>
        {valido.success && <a className="btn btn-outline-secondary" href={reportesApi.csvUrl(tab, desde, hasta)}>Exportar CSV (Excel)</a>}
      </div>
      {!valido.success && <div className="alert alert-warning">{valido.error.issues[0].message}</div>}
      {error && <div className="alert alert-danger">{mensajeError(error)}</div>}

      {tab === 'ingresos' && ingresos.data && (() => {
        const r = ingresos.data;
        return (
          <>
            <div className="row g-3 mb-3">
              {[
                ['Total cobrado', solesPE(r.resumen.total)],
                ['Comprobantes', String(r.resumen.comprobantes)],
                ['Ticket promedio', solesPE(r.resumen.ticketPromedio)],
                ['Descuentos otorgados', solesPE(r.resumen.descuentos)],
              ].map(([t, v]) => (
                <div className="col-6 col-lg-3" key={t}><div className="tarjeta"><div className="small text-muted">{t}</div><div className="fs-4 fw-semibold">{v}</div></div></div>
              ))}
            </div>
            <div className="row g-3 mb-3">
              <div className="col-lg-5">
                <div className="tarjeta h-100">
                  <h2 className="h6">Por tipo de pago</h2>
                  <table className="table table-sm mb-0"><tbody>
                    {r.porTipoPago.map((t) => <tr key={t.tipo}><td>{t.tipo}</td><td className="text-end text-muted small">{t.cantidad}</td><td className="text-end">{solesPE(t.total)}</td></tr>)}
                    {r.porTipoPago.length === 0 && <tr><td className="text-muted">Sin cobros en el periodo.</td></tr>}
                  </tbody></table>
                  {Number(r.resumen.adelantos) > 0 && <p className="small text-muted mt-2 mb-0">Incluye {solesPE(r.resumen.adelantos)} de adelantos (RN-12).</p>}
                </div>
              </div>
              <div className="col-lg-7">
                <div className="tarjeta h-100">
                  <h2 className="h6">Por tratamiento <span className="small text-muted fw-normal">(importe según tarifario, antes de descuentos)</span></h2>
                  <table className="table table-sm mb-0"><tbody>
                    {r.porTratamiento.map((t) => <tr key={t.tratamiento}><td>{t.tratamiento}</td><td className="text-end text-muted small">×{t.cantidad}</td><td className="text-end">{solesPE(t.importe)}</td></tr>)}
                  </tbody></table>
                </div>
              </div>
            </div>
            <div className="tarjeta p-0">
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0 small">
                  <thead><tr><th>N.°</th><th>Fecha</th><th>Paciente</th><th>Pago</th><th className="text-end">Total</th></tr></thead>
                  <tbody>
                    {r.detalle.map((d) => (
                      <tr key={d.numero}>
                        <td className="text-nowrap">{d.numero}{d.tipo === 'adelanto' && <span className="badge text-bg-warning ms-1">Adelanto</span>}</td>
                        <td className="text-nowrap">{fechaHoraPE(d.fecha)}</td><td>{d.paciente}</td><td>{d.tipoPago}</td><td className="text-end">{solesPE(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
      })()}

      {tab === 'inventario' && inventario.data && (() => {
        const r = inventario.data;
        return (
          <>
            <p className="small text-muted">
              Movimientos del {fechaPE(r.desde)} al {fechaPE(r.hasta)} · {r.resumen.insumosActivos} insumos activos · <strong className="text-danger">{r.resumen.bajoMinimo} en stock mínimo</strong>
              {Object.entries(r.resumen.pedidos).map(([e, n]) => ` · ${n} pedido(s) ${ETIQUETA_ESTADO_PEDIDO[e as EstadoPedido].toLowerCase()}`)}
            </p>
            <div className="tarjeta p-0">
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0 small">
                  <thead><tr><th>Insumo</th><th className="text-end">Stock</th><th className="text-end">Mínimo</th><th className="text-end">Entradas</th><th className="text-end">Consumo</th><th className="text-end">Ajustes</th><th className="text-end">Mermas</th></tr></thead>
                  <tbody>
                    {r.insumos.map((i) => (
                      <tr key={i.id} className={!i.activo ? 'text-muted' : i.bajoMinimo ? 'table-warning' : ''}>
                        <td>{i.nombre} <span className="text-muted">({i.unidad})</span></td>
                        <td className="text-end fw-semibold">{numPE(i.stockActual)}</td><td className="text-end">{numPE(i.stockMinimo)}</td>
                        <td className="text-end">{numPE(i.entradas)}</td><td className="text-end">{numPE(i.consumo)}</td><td className="text-end">{numPE(i.ajustes)}</td><td className="text-end">{numPE(i.mermas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
