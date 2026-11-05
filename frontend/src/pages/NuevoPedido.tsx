import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pedidoSchema } from '@clinica/shared';
import { insumosApi, pedidosApi, proveedoresApi, type Insumo, type Pedido } from '../api/recursos';
import { FormProveedor } from './Proveedores';
import { AvisoFlotante, BotonAccion, IconoPapelera } from '../components/Interaccion';
import { erroresZod, mensajeError, numPE } from '../formato';
import { buscar } from '../buscar';

interface Linea { insumo: Insumo; cantidad: string; desdeAlerta?: boolean }

/** CU-30 Registrar pedido. ?alertas=1 → precarga los insumos con alerta (1.1); ?insumos=1,2 → esos insumos. */
export default function NuevoPedido() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [proveedorId, setProveedorId] = useState<number | ''>('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState(false);
  // «Quitar todos» con deshacer: se guardan las líneas quitadas mientras se muestra el aviso
  const [quitadas, setQuitadas] = useState<Linea[] | null>(null);
  const cerrarAviso = useCallback(() => setQuitadas(null), []);
  const [proveedorSugerido, setProveedorSugerido] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [registrado, setRegistrado] = useState<Pedido | null>(null);

  const proveedores = useQuery({ queryKey: ['proveedores', '', '1'], queryFn: () => proveedoresApi.listar({ activo: '1' }) });
  // CU-22 Buscar insumo: la lista completa de activos se filtra al instante (sin tildes, por parte del nombre y con errores)
  const todos = useQuery({ queryKey: ['insumos-activos'], queryFn: () => insumosApi.listar({ activo: '1' }) });
  const resultados = buscar(todos.data ?? [], busqueda, (i) => i.bajoMinimo).filter((r) => !lineas.some((l) => l.insumo.id === r.item.id));
  const soloAproximados = busqueda.trim() !== '' && resultados.length > 0 && resultados.every((r) => r.aproximado);

  // 1.1: llegar desde una alerta (CU-24) precarga los insumos en alerta
  const precargado = useRef(false);
  const ids = params.get('insumos')?.split(',').map(Number).filter(Boolean) ?? [];
  const desdeAlertas = params.get('alertas') === '1';
  const precarga = useQuery({ queryKey: ['precarga', desdeAlertas, ids.join(',')], queryFn: () => insumosApi.listar({ activo: '1' }), enabled: desdeAlertas || ids.length > 0 });
  useEffect(() => {
    if (precargado.current || !precarga.data) return;
    precargado.current = true;
    const elegidos = precarga.data.filter((i) => (ids.length ? ids.includes(i.id) : i.bajoMinimo));
    // cantidad sugerida: lo que falta para duplicar el mínimo
    setLineas(elegidos.map((i) => ({ insumo: i, desdeAlerta: true, cantidad: String(Math.max(1, Math.ceil(Number(i.stockMinimo) * 2 - Number(i.stockActual)))) })));
  }, [precarga.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Proveedor sugerido: el del último pedido que incluyó alguno de los insumos que vienen de la alerta
  const desdeAlerta = lineas.filter((l) => l.desdeAlerta);
  const historial = useQuery({ queryKey: ['pedidos', 'historial'], queryFn: () => pedidosApi.listar({}), enabled: desdeAlertas || ids.length > 0 });
  const sugerido = useRef(false);
  useEffect(() => {
    if (sugerido.current || !historial.data || !proveedores.data || desdeAlerta.length === 0) return;
    sugerido.current = true;
    const ids = new Set(desdeAlerta.map((l) => l.insumo.id));
    const ultimo = [...historial.data.pedidos]
      .filter((p) => p.estado !== 'anulado' && p.detalles.some((d) => ids.has(d.insumoId)))
      .sort((a, b) => b.id - a.id)
      .find((p) => proveedores.data.some((x) => x.id === p.proveedor.id));
    if (ultimo && proveedorId === '') {
      setProveedorId(ultimo.proveedor.id);
      setProveedorSugerido(desdeAlerta.find((l) => ultimo.detalles.some((d) => d.insumoId === l.insumo.id))?.insumo.nombre ?? null);
    }
  }, [historial.data, proveedores.data, desdeAlerta.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = useMutation({
    mutationFn: pedidosApi.registrar,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['pedidos'] }); setRegistrado(p); },
  });

  function agregar(i: Insumo) {
    if (!lineas.some((l) => l.insumo.id === i.id)) setLineas([...lineas, { insumo: i, cantidad: '1' }]);
    setBusqueda('');
    setAbierto(false);
  }
  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = pedidoSchema.safeParse({ proveedorId: proveedorId || 0, insumos: lineas.map((l) => ({ insumoId: l.insumo.id, cantidad: l.cantidad })) });
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }

  if (registrado) {
    return (
      <div className="tarjeta">
        <h1 className="h5">Pedido {registrado.codigo} registrado</h1>
        <p>{registrado.proveedor.razonSocial} · {registrado.detalles.length} insumo(s). Queda «Pendiente»: el stock se actualizará al registrar la recepción.</p>
        <div className="d-flex flex-wrap gap-2">
          <a className="btn btn-outline-secondary" href={pedidosApi.pdfUrl(registrado.id)} target="_blank" rel="noreferrer">Descargar PDF</a>
          <Link className="btn btn-acento" to="/pedidos">Ir a pedidos</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-baseline mb-3">
        <h1 className="h4 mb-0">Nuevo pedido</h1>
        <Link to="/pedidos" className="small">← Pedidos</Link>
      </div>
      <form className="tarjeta" onSubmit={enviar} noValidate>
        {desdeAlerta.length > 0 && (
          <div className="alert alert-primary d-flex gap-2 align-items-start" role="status">
            <span style={{ fontSize: '1.4rem', lineHeight: 1 }} aria-hidden="true">📦</span>
            <div>
              <strong>Pedido desde Alertas de stock.</strong> Ya se agregó{' '}
              {desdeAlerta.length === 1 ? (
                <>
                  <strong>{desdeAlerta[0].insumo.nombre}</strong> con <strong>{numPE(desdeAlerta[0].cantidad)} {desdeAlerta[0].insumo.unidad}</strong> sugeridos
                </>
              ) : (
                <strong>{desdeAlerta.length} insumos</strong>
              )}{' '}
              (para llegar al doble del mínimo). Revise la cantidad y elija el proveedor.
            </div>
          </div>
        )}
        <label htmlFor="proveedor" className="form-label">Proveedor</label>
        <div className="d-flex gap-2 mb-1">
          <select id="proveedor" className={`form-select ${errores.proveedorId ? 'is-invalid' : ''}`} value={proveedorId} onChange={(e) => { setProveedorId(e.target.value ? Number(e.target.value) : ''); setProveedorSugerido(null); }}>
            <option value="">Seleccione…</option>
            {proveedores.data?.map((p) => <option key={p.id} value={p.id}>{p.razonSocial} — RUC {p.ruc}</option>)}
          </select>
          {/* 3.1: proveedor no registrado → registrarlo antes (CU-26) */}
          <button type="button" className="btn btn-outline-secondary text-nowrap" onClick={() => setNuevoProveedor(true)}>+ Proveedor</button>
        </div>
        {proveedorSugerido && <div className="form-text mb-2">💡 Sugerido: el último proveedor al que se le pidió <strong>{proveedorSugerido}</strong>. Puede cambiarlo.</div>}
        {errores.proveedorId && <div className="text-danger small mb-2">{errores.proveedorId}</div>}

        <h2 className="h6 mt-3 d-flex align-items-center gap-1">
          Insumos del pedido {lineas.length > 0 && <span className="badge text-bg-primary ms-1">{lineas.length}</span>}
          {lineas.length >= 2 && (
            <button type="button" className="btn-quitar-todos ms-auto" onClick={() => { setQuitadas(lineas); setLineas([]); }}>
              <IconoPapelera /> Quitar todos
            </button>
          )}
        </h2>
        {errores.insumos && <div className="text-danger small mb-2">{errores.insumos}</div>}
        {lineas.length === 0 && <p className="small text-muted">Aún no agregó insumos.</p>}
        {lineas.map((l, n) => (
          <div className={`linea-pedido d-flex align-items-center gap-2 mb-2 aparece ${l.desdeAlerta ? 'desde-alerta' : ''}`} key={l.insumo.id}>
            <div className="flex-grow-1">
              <strong>{l.insumo.nombre}</strong>{' '}
              {l.desdeAlerta ? <span className="badge text-bg-warning">Desde alerta</span> : <span className="badge text-bg-light border">Agregado</span>}
              <div className="small text-muted">stock {numPE(l.insumo.stockActual)} / mín. {numPE(l.insumo.stockMinimo)} {l.insumo.unidad}</div>
            </div>
            <input aria-label={`Cantidad de ${l.insumo.nombre}`} inputMode="decimal" style={{ maxWidth: 100 }} className={`form-control ${errores[`insumos.${n}.cantidad`] ? 'is-invalid' : ''}`} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, i) => (i === n ? { ...x, cantidad: e.target.value } : x)))} />
            <button type="button" className="btn btn-outline-secondary" aria-label={`Quitar ${l.insumo.nombre}`} onClick={() => setLineas(lineas.filter((_, i) => i !== n))}>✕</button>
          </div>
        ))}

        <label htmlFor="buscar-insumo" className={lineas.length ? 'form-label mt-3 small text-muted' : 'form-label mt-3'}>
          {lineas.length ? 'Agregar otro insumo (opcional)' : 'Agregar insumo'}
        </label>
        <input
          id="buscar-insumo"
          className={`form-control ${lineas.length ? 'form-control-sm' : ''}`}
          placeholder="Escriba parte del nombre o toque para ver todos"
          value={busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => e.key === 'Escape' && setAbierto(false)}
          autoComplete="off"
          role="combobox"
          aria-expanded={abierto}
          aria-controls="lista-insumos"
        />
        {abierto && (
          <div id="lista-insumos" className="list-group mt-1 mb-2 shadow-sm" role="listbox" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {!busqueda.trim() && <div className="list-group-item small text-muted bg-body-tertiary">Todos los insumos activos · primero los que están en stock mínimo</div>}
            {soloAproximados && <div className="list-group-item small text-muted bg-body-tertiary">No hay «{busqueda.trim()}» exacto. ¿Quiso decir…?</div>}
            {resultados.map(({ item: i }) => (
              <button type="button" role="option" aria-selected={false} key={i.id} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-2" onMouseDown={(e) => e.preventDefault()} onClick={() => agregar(i)}>
                <span>
                  {i.nombre} {i.bajoMinimo && <span className="badge text-bg-warning ms-1">⚠ En mínimo</span>}
                </span>
                <span className="small text-muted text-nowrap">stock {numPE(i.stockActual)} / mín. {numPE(i.stockMinimo)} {i.unidad}</span>
              </button>
            ))}
            {resultados.length === 0 && <div className="list-group-item small text-muted">Sin resultados</div>}
          </div>
        )}
        {guardar.isError && <div className="alert alert-danger mt-3" role="alert">{mensajeError(guardar.error)}</div>}
        <BotonAccion className="btn btn-acento w-100 mt-3" mutacion={guardar} textoPendiente="Registrando…">Registrar pedido</BotonAccion>
      </form>
      {quitadas && (
        <AvisoFlotante
          icono={<IconoPapelera tam={16} />}
          onCerrar={cerrarAviso}
          accion={{ texto: '↶ Deshacer', onClick: () => { setLineas([...quitadas, ...lineas.filter((l) => !quitadas.some((q) => q.insumo.id === l.insumo.id))]); setQuitadas(null); } }}
        >
          Se quitaron <strong>{quitadas.length} insumos</strong> del pedido
        </AvisoFlotante>
      )}
      {nuevoProveedor && <FormProveedor proveedor={null} onCerrar={() => setNuevoProveedor(false)} onGuardado={(p) => setProveedorId(p.id)} />}
    </>
  );
}
