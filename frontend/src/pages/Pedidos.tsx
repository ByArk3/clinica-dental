import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { anularPedidoSchema, ESTADOS_PEDIDO, ETIQUETA_ESTADO_PEDIDO } from '@clinica/shared';
import { pedidosApi, type Pedido } from '../api/recursos';
import { ChipPedido } from '../components/ChipPedido';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { fechaHoraPE, mensajeError, numPE } from '../formato';

/** CU-31 Listar pedidos · CU-32 Anular · acceso a CU-30 (nuevo) y CU-33 (recepción). */
export default function Pedidos() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState('pendiente');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<number | null>(null);
  const [anular, setAnular] = useState<Pedido | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errMotivo, setErrMotivo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = useQuery({ queryKey: ['pedidos', estado, q], queryFn: () => pedidosApi.listar({ estado, q }) });
  const anulacion = useMutation({
    mutationFn: () => pedidosApi.anular(anular!.id, motivo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pedidos'] }); cerrarAnular(); },
  });
  const envio = useMutation({ mutationFn: (id: number) => pedidosApi.enviar(id), onSuccess: (r) => setAviso(r.mensaje), onError: (e) => setAviso(mensajeError(e)) });
  function cerrarAnular() { setAnular(null); setMotivo(''); setErrMotivo(null); anulacion.reset(); }

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">Pedidos</h1>
        <Link to="/pedidos/nuevo" className="btn btn-acento">+ Nuevo pedido</Link>
      </div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Código o proveedor" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="form-select" style={{ maxWidth: 220 }} aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
          {ESTADOS_PEDIDO.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_PEDIDO[e]}</option>)}
          <option value="">Todos</option>
        </select>
      </div>
      {aviso && <div className="alert alert-info alert-dismissible">{aviso}<button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} /></div>}
      {lista.data?.mensaje && <div className="tarjeta text-muted">{lista.data.mensaje}</div>}
      {lista.data && !lista.data.mensaje && lista.data.pedidos.length === 0 && <div className="tarjeta text-muted">Sin pedidos.</div>}
      <div className="d-grid gap-2">
        {lista.data?.pedidos.map((p) => (
          <div className="tarjeta py-3" key={p.id}>
            <div className="d-flex flex-wrap justify-content-between gap-2">
              <div>
                <strong className="me-2">{p.codigo}</strong>{p.proveedor.razonSocial}
                <div className="small text-muted">{fechaHoraPE(p.fecha)} · {p.detalles.length} insumo(s) · {p.registradoPor}</div>
              </div>
              <ChipPedido estado={p.estado} />
            </div>
            {abierto === p.id && (
              <table className="table table-sm small mt-2 mb-1">
                <thead><tr><th>Insumo</th><th className="text-end">Pedido</th><th className="text-end">Recibido</th></tr></thead>
                <tbody>
                  {p.detalles.map((d) => (
                    <tr key={d.id} className={d.cantidadRecibida !== null && d.cantidadRecibida !== d.cantidadPedida ? 'table-warning' : ''}>
                      <td>{d.insumo}</td>
                      <td className="text-end">{numPE(d.cantidadPedida)} {d.unidad}</td>
                      <td className="text-end">{d.cantidadRecibida !== null ? numPE(d.cantidadRecibida) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.motivoAnulacion && <div className="small">Motivo de anulación: {p.motivoAnulacion}</div>}
            {p.observacionRecepcion && <div className="small">Observación de recepción: {p.observacionRecepcion}</div>}
            <div className="d-flex flex-wrap gap-2 mt-2">
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setAbierto(abierto === p.id ? null : p.id)}>{abierto === p.id ? 'Ocultar detalle' : 'Ver detalle'}</button>
              <a className="btn btn-sm btn-outline-secondary" href={pedidosApi.pdfUrl(p.id)} target="_blank" rel="noreferrer">PDF</a>
              {p.estado === 'pendiente' && (
                <>
                  <button className="btn btn-sm btn-outline-secondary" disabled={!p.proveedor.email || envio.isPending} title={p.proveedor.email ? undefined : 'El proveedor no tiene correo registrado'} onClick={() => envio.mutate(p.id)}>Enviar al proveedor</button>
                  <Link className="btn btn-sm btn-acento" to={`/pedidos/${p.id}/recepcion`}>Registrar recepción</Link>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => setAnular(p)}>Anular</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <ModalConfirmar
        abierto={!!anular}
        titulo={`Anular pedido ${anular?.codigo ?? ''}`}
        textoConfirmar="Anular pedido"
        peligro
        procesando={anulacion.isPending}
        error={errMotivo ?? (anulacion.isError ? mensajeError(anulacion.error) : null)}
        onConfirmar={() => {
          const r = anularPedidoSchema.safeParse({ motivo });
          if (!r.success) return setErrMotivo(r.error.issues[0].message);
          setErrMotivo(null);
          anulacion.mutate();
        }}
        onCerrar={cerrarAnular}
      >
        <label htmlFor="motivo-anulacion" className="form-label">Motivo de la anulación</label>
        <input id="motivo-anulacion" className="form-control" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </ModalConfirmar>
    </>
  );
}
