import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ETIQUETA_ESTADO_CITA, type EstadoCita } from '@clinica/shared';
import { reportesApi } from '../api/recursos';
import { diaSemanaPE, fechaPE, numPE, solesPE } from '../formato';

function Indicador({ titulo, valor, detalle, a }: { titulo: string; valor: string | number; detalle?: string; a?: string }) {
  const cuerpo = (
    <div className="tarjeta h-100 indicador">
      <div className="small text-muted">{titulo}</div>
      <div className="fs-3 fw-semibold">{valor}</div>
      {detalle && <div className="small text-muted">{detalle}</div>}
    </div>
  );
  return <div className="col-6 col-lg-3">{a ? <Link to={a} className="text-reset text-decoration-none">{cuerpo}</Link> : cuerpo}</div>;
}

/** CU-38 Consultar panel de control (Administrador). */
export default function Panel() {
  const { data: p, isLoading } = useQuery({ queryKey: ['panel'], queryFn: reportesApi.panel, refetchInterval: 60_000 });
  if (isLoading || !p) return <p className="text-muted">Cargando…</p>;
  const estados = Object.entries(p.citasHoy.porEstado) as [EstadoCita, number][];
  return (
    <>
      <h1 className="h4 mb-1">Panel de control</h1>
      <p className="text-muted text-capitalize-first mb-3">{diaSemanaPE(p.fecha)} {fechaPE(p.fecha)}</p>
      <div className="row g-3 mb-3">
        <Indicador titulo="Ingresos de hoy" valor={solesPE(p.ingresos.hoy)} detalle={`${p.ingresos.comprobantesHoy} comprobante(s)`} a="/reportes" />
        <Indicador titulo="Ingresos del mes" valor={solesPE(p.ingresos.mes)} detalle={`${p.ingresos.comprobantesMes} comprobante(s)`} a="/reportes" />
        <Indicador titulo="Citas de hoy" valor={p.citasHoy.total} detalle={`${p.agenda.porConfirmar48h} por confirmar en 48 h`} />
        <Indicador titulo="Alertas de stock" valor={p.inventario.alertasPendientes} detalle={`${p.inventario.pedidosPendientes} pedido(s) pendiente(s)`} a="/alertas" />
      </div>
      <div className="row g-3">
        <div className="col-lg-4">
          <div className="tarjeta h-100">
            <h2 className="h6">Citas de hoy por estado</h2>
            {estados.length === 0 ? <p className="small text-muted mb-0">No hay citas hoy.</p> : (
              <ul className="list-unstyled mb-0">
                {estados.map(([e, n]) => <li key={e} className="d-flex justify-content-between py-1"><span className={`chip chip-${e}`}>{ETIQUETA_ESTADO_CITA[e]}</span><strong>{n}</strong></li>)}
              </ul>
            )}
            <hr />
            <div className="small">Inasistencias este mes: <strong>{p.agenda.inasistenciasMes}</strong></div>
            <div className="small">Pacientes con 3+ faltas (pagan adelanto): <strong>{p.agenda.pacientesRestringidos}</strong></div>
            <div className="small">Pagos de adelanto por verificar en caja: <strong>{p.agenda.pagosPorVerificar}</strong></div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="tarjeta h-100">
            <h2 className="h6">Ingresos de los últimos 7 días</h2>
            <table className="table table-sm mb-0">
              <tbody>
                {p.ingresos.ultimos7Dias.map((d) => (
                  <tr key={d.fecha}><td className="text-capitalize-first">{diaSemanaPE(d.fecha).slice(0, 3)} {fechaPE(d.fecha).slice(0, 5)}</td><td className="text-end">{solesPE(d.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="tarjeta h-100">
            <h2 className="h6">Insumos en stock mínimo</h2>
            {p.inventario.alertas.length === 0 ? <p className="small text-muted mb-0">Todo el inventario está sobre el mínimo.</p> : (
              <>
                <ul className="list-unstyled small">
                  {p.inventario.alertas.map((a) => <li key={a.id} className="d-flex justify-content-between py-1"><span>{a.insumo}</span><span className="text-danger">{numPE(a.stockActual)} / {numPE(a.stockMinimo)}</span></li>)}
                </ul>
                <Link to="/pedidos/nuevo?alertas=1" className="btn btn-sm btn-acento">Hacer pedido</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
