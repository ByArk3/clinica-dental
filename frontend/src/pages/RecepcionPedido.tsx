import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MENSAJES } from '@clinica/shared';
import { pedidosApi, type Pedido } from '../api/recursos';
import { ChipPedido } from '../components/ChipPedido';
import { BotonAccion } from '../components/Interaccion';
import { camposApi, fechaHoraPE, mensajeError, numPE } from '../formato';

/** CU-33 (i_recepcion): ingresar lo recibido, verificar contra el pedido (RN-15) y sumar al stock. */
export default function RecepcionPedido() {
  const { id } = useParams();
  const qc = useQueryClient();
  const pedido = useQuery({ queryKey: ['pedido', id], queryFn: () => pedidosApi.ver(Number(id)) });
  const [recibido, setRecibido] = useState<Record<number, string>>({});
  const [verificado, setVerificado] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<Pedido | null>(null);

  // Por defecto, lo recibido = lo pedido; el usuario corrige las diferencias
  useEffect(() => {
    if (pedido.data) setRecibido(Object.fromEntries(pedido.data.detalles.map((d) => [d.id, String(Number(d.cantidadPedida))])));
  }, [pedido.data]);

  const guardar = useMutation({
    mutationFn: () =>
      pedidosApi.recepcion(Number(id), {
        verificado: true,
        items: pedido.data!.detalles.map((d) => ({ detalleId: d.id, cantidadRecibida: Number(recibido[d.id].replace(',', '.')) })),
        observacion: observacion || undefined,
      }),
    onSuccess: (p) => { qc.invalidateQueries(); setResultado(p); },
    onError: (e) => setErrores(camposApi(e)),
  });

  if (pedido.isLoading) return <p className="text-muted">Cargando…</p>;
  if (pedido.isError) return <div className="alert alert-danger">{mensajeError(pedido.error)}</div>;
  const p = resultado ?? pedido.data!;
  const diferencias = p.detalles.filter((d) => recibido[d.id] !== undefined && Number((recibido[d.id] || 'x').replace(',', '.')) !== Number(d.cantidadPedida));

  function enviar(e: FormEvent) {
    e.preventDefault();
    const c: Record<string, string> = {};
    for (const d of p.detalles) {
      const n = Number((recibido[d.id] ?? '').replace(',', '.'));
      if (recibido[d.id] === '' || Number.isNaN(n) || n < 0) c[`item.${d.id}`] = 'Cantidad inválida';
    }
    if (!verificado) c.verificado = MENSAJES.VERIFICACION_REQUERIDA;
    if (diferencias.length > 0 && !observacion.trim()) c.observacion = MENSAJES.OBSERVACION_REQUERIDA; // 6.1
    setErrores(c);
    if (Object.keys(c).length === 0) guardar.mutate();
  }

  if (resultado) {
    return (
      <div className="tarjeta">
        <h1 className="h5">Recepción del pedido {p.codigo} registrada</h1>
        <p><ChipPedido estado={p.estado} /></p>
        <p>El stock de los insumos recibidos ya fue actualizado y quedó registrado en el kárdex.</p>
        <div className="d-flex gap-2">
          <Link className="btn btn-outline-secondary" to="/insumos">Ver insumos</Link>
          <Link className="btn btn-acento" to="/pedidos">Volver a pedidos</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-baseline mb-3">
        <h1 className="h4 mb-0">Recepción de {p.codigo}</h1>
        <Link to="/pedidos" className="small">← Pedidos</Link>
      </div>
      <p className="mb-3">{p.proveedor.razonSocial} · pedido el {fechaHoraPE(p.fecha)} <ChipPedido estado={p.estado} /></p>
      {p.estado !== 'pendiente' ? (
        <div className="alert alert-warning">{MENSAJES.PEDIDO_NO_PENDIENTE}</div>
      ) : (
        <form className="tarjeta" onSubmit={enviar} noValidate>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead><tr><th>Insumo</th><th className="text-end">Pedido</th><th style={{ width: 130 }}>Recibido</th></tr></thead>
              <tbody>
                {p.detalles.map((d) => {
                  const dif = diferencias.includes(d);
                  return (
                    <tr key={d.id} className={dif ? 'table-warning' : ''}>
                      <td>{d.insumo}<div className="small text-muted">stock actual {numPE(d.stockActual)} {d.unidad}</div></td>
                      <td className="text-end">{numPE(d.cantidadPedida)}</td>
                      <td>
                        <input aria-label={`Recibido de ${d.insumo}`} inputMode="decimal" className={`form-control ${errores[`item.${d.id}`] ? 'is-invalid' : ''}`} value={recibido[d.id] ?? ''} onChange={(e) => setRecibido({ ...recibido, [d.id]: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {diferencias.length > 0 && <div className="alert alert-warning small py-2">Hay {diferencias.length} diferencia(s) con lo pedido: el pedido quedará «Recibido con diferencias» y solo se sumará lo recibido.</div>}
          <div className="mb-3">
            <label htmlFor="observacion" className="form-label">Observación {diferencias.length > 0 ? '*' : '(opcional)'}</label>
            <textarea id="observacion" rows={2} className={`form-control ${errores.observacion ? 'is-invalid' : ''}`} value={observacion} onChange={(e) => setObservacion(e.target.value)} />
            <div className="invalid-feedback">{errores.observacion}</div>
          </div>
          <div className="form-check mb-3">
            <input id="verificado" type="checkbox" className={`form-check-input ${errores.verificado ? 'is-invalid' : ''}`} checked={verificado} onChange={(e) => setVerificado(e.target.checked)} />
            <label htmlFor="verificado" className="form-check-label">Verifiqué lo recibido contra el pedido</label>
            <div className="invalid-feedback">{errores.verificado}</div>
          </div>
          {guardar.isError && <div className="alert alert-danger" role="alert">{mensajeError(guardar.error)}</div>}
          <BotonAccion className="btn btn-acento w-100" mutacion={guardar} textoPendiente="Registrando…">Registrar recepción</BotonAccion>
        </form>
      )}
    </>
  );
}
