import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insumosApi } from '../api/recursos';
import { fechaHoraPE, mensajeError, numPE } from '../formato';

/** CU-24 Revisar alertas de stock mínimo (RN-14): marcar revisadas o generar el pedido (CU-30 1.1). */
export default function Alertas() {
  const qc = useQueryClient();
  const [todas, setTodas] = useState(false);
  const [elegidas, setElegidas] = useState<number[]>([]);
  const alertas = useQuery({ queryKey: ['alertas', todas], queryFn: () => insumosApi.alertas(todas ? { todas: '1' } : {}) });
  const [saliendo, setSaliendo] = useState<number | null>(null);
  const revisar = useMutation({
    // la tarjeta se desvanece y luego se marca (la lista se acomoda sola)
    mutationFn: async (id: number) => {
      setSaliendo(id);
      await new Promise((r) => setTimeout(r, todas ? 0 : 250));
      return insumosApi.revisarAlerta(id);
    },
    onSettled: () => setSaliendo(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertas'] }),
  });
  // Revisada por error: vuelve a pendiente (solo si el insumo sigue en el mínimo o por debajo)
  const reabrir = useMutation({
    mutationFn: (id: number) => insumosApi.reabrirAlerta(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertas'] }),
  });
  const pendientes = alertas.data?.filter((a) => !a.revisada) ?? [];
  const insumosElegidos = pendientes.filter((a) => elegidas.includes(a.id)).map((a) => a.insumo.id);

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">Alertas de stock mínimo</h1>
        <Link className={`btn btn-acento ${pendientes.length === 0 ? 'disabled' : ''}`} to={insumosElegidos.length ? `/pedidos/nuevo?insumos=${insumosElegidos.join(',')}` : '/pedidos/nuevo?alertas=1'}>
          {insumosElegidos.length ? `Pedir ${insumosElegidos.length} seleccionado(s)` : 'Pedir todos los insumos en alerta'}
        </Link>
      </div>
      <div className="form-check mb-3">
        <input id="ver-todas" type="checkbox" className="form-check-input" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
        <label htmlFor="ver-todas" className="form-check-label">Mostrar también las revisadas</label>
      </div>
      {revisar.isError && <div className="alert alert-danger">{mensajeError(revisar.error)}</div>}
      {reabrir.isError && <div className="alert alert-danger">{mensajeError(reabrir.error)}</div>}
      {alertas.data?.length === 0 && <div className="tarjeta text-muted">No hay alertas pendientes. 👍</div>}
      <div className="d-grid gap-2">
        {alertas.data?.map((a) => (
          <div className={`tarjeta tarjeta-alerta py-3 aparece ${a.revisada ? 'opacity-75' : ''} ${elegidas.includes(a.id) ? 'seleccionada' : ''} ${saliendo === a.id ? 'saliendo' : ''}`} key={a.id}>
            <div className="d-flex flex-wrap gap-3 align-items-start">
              {!a.revisada && (
                <input type="checkbox" className="form-check-input mt-1" aria-label={`Seleccionar ${a.insumo.nombre}`} checked={elegidas.includes(a.id)} onChange={(e) => setElegidas(e.target.checked ? [...elegidas, a.id] : elegidas.filter((x) => x !== a.id))} />
              )}
              <div className="flex-grow-1">
                <strong>{a.insumo.nombre}</strong>
                <div className="small">
                  Stock actual <strong>{numPE(a.insumo.stockActual)}</strong> / mínimo {numPE(a.insumo.stockMinimo)} {a.insumo.unidad}
                  <span className="text-muted"> · alerta del {fechaHoraPE(a.fecha)} (stock {numPE(a.stockAlGenerar)})</span>
                </div>
                {a.revisada && <div className="small text-muted">Revisada por {a.revisadaPor} el {a.revisadaEn && fechaHoraPE(a.revisadaEn)}</div>}
              </div>
              {!a.revisada ? (
                <div className="d-flex gap-2">
                  <Link className="btn btn-sm btn-outline-secondary" to={`/pedidos/nuevo?insumos=${a.insumo.id}`}>Pedir</Link>
                  <button className="btn btn-sm btn-outline-secondary" disabled={revisar.isPending} onClick={() => revisar.mutate(a.id)}>Marcar revisada</button>
                </div>
              ) : (
                a.insumo.bajoMinimo && !pendientes.some((x) => x.insumo.id === a.insumo.id) && (
                  <div className="d-flex gap-2">
                    <Link className="btn btn-sm btn-outline-secondary" to={`/pedidos/nuevo?insumos=${a.insumo.id}`}>Pedir</Link>
                    <button className="btn btn-sm btn-outline-primary" disabled={reabrir.isPending} onClick={() => reabrir.mutate(a.id)}>Volver a pendiente</button>
                  </div>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
