import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pedidoSchema } from '@clinica/shared';
import { insumosApi, pedidosApi, proveedoresApi, type Insumo, type Pedido } from '../api/recursos';
import { FormProveedor } from './Proveedores';
import { erroresZod, mensajeError, numPE } from '../formato';

interface Linea { insumo: Insumo; cantidad: string }

/** CU-30 Registrar pedido. ?alertas=1 → precarga los insumos con alerta (1.1); ?insumos=1,2 → esos insumos. */
export default function NuevoPedido() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [proveedorId, setProveedorId] = useState<number | ''>('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [registrado, setRegistrado] = useState<Pedido | null>(null);

  const proveedores = useQuery({ queryKey: ['proveedores', '', '1'], queryFn: () => proveedoresApi.listar({ activo: '1' }) });
  // CU-22 Buscar insumo
  const encontrados = useQuery({ queryKey: ['buscar-insumo', busqueda], queryFn: () => insumosApi.buscar(busqueda), enabled: busqueda.trim().length >= 2 });

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
    setLineas(elegidos.map((i) => ({ insumo: i, cantidad: String(Math.max(1, Math.ceil(Number(i.stockMinimo) * 2 - Number(i.stockActual)))) })));
  }, [precarga.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = useMutation({
    mutationFn: pedidosApi.registrar,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['pedidos'] }); setRegistrado(p); },
  });

  function agregar(i: Insumo) {
    if (!lineas.some((l) => l.insumo.id === i.id)) setLineas([...lineas, { insumo: i, cantidad: '1' }]);
    setBusqueda('');
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
        <label htmlFor="proveedor" className="form-label">Proveedor</label>
        <div className="d-flex gap-2 mb-1">
          <select id="proveedor" className={`form-select ${errores.proveedorId ? 'is-invalid' : ''}`} value={proveedorId} onChange={(e) => setProveedorId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Seleccione…</option>
            {proveedores.data?.map((p) => <option key={p.id} value={p.id}>{p.razonSocial} — RUC {p.ruc}</option>)}
          </select>
          {/* 3.1: proveedor no registrado → registrarlo antes (CU-26) */}
          <button type="button" className="btn btn-outline-secondary text-nowrap" onClick={() => setNuevoProveedor(true)}>+ Proveedor</button>
        </div>
        {errores.proveedorId && <div className="text-danger small mb-2">{errores.proveedorId}</div>}

        <label htmlFor="buscar-insumo" className="form-label mt-3">Agregar insumo</label>
        <input id="buscar-insumo" className="form-control" placeholder="Escriba al menos 2 letras" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoComplete="off" />
        {busqueda.trim().length >= 2 && (
          <div className="list-group mt-1 mb-2">
            {encontrados.data?.map((i) => (
              <button type="button" key={i.id} className="list-group-item list-group-item-action small" onClick={() => agregar(i)}>
                {i.nombre} <span className="text-muted">· stock {numPE(i.stockActual)} / mín. {numPE(i.stockMinimo)} {i.unidad}</span>
              </button>
            ))}
            {encontrados.data?.length === 0 && <div className="list-group-item small text-muted">Sin resultados</div>}
          </div>
        )}

        <h2 className="h6 mt-3">Insumos del pedido</h2>
        {errores.insumos && <div className="text-danger small mb-2">{errores.insumos}</div>}
        {lineas.length === 0 && <p className="small text-muted">Aún no agregó insumos.</p>}
        {lineas.map((l, n) => (
          <div className="d-flex align-items-center gap-2 mb-2" key={l.insumo.id}>
            <div className="flex-grow-1 small">
              {l.insumo.nombre}
              <div className="text-muted">stock {numPE(l.insumo.stockActual)} / mín. {numPE(l.insumo.stockMinimo)} {l.insumo.unidad}</div>
            </div>
            <input aria-label={`Cantidad de ${l.insumo.nombre}`} inputMode="decimal" style={{ maxWidth: 100 }} className={`form-control ${errores[`insumos.${n}.cantidad`] ? 'is-invalid' : ''}`} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, i) => (i === n ? { ...x, cantidad: e.target.value } : x)))} />
            <button type="button" className="btn btn-outline-secondary" aria-label={`Quitar ${l.insumo.nombre}`} onClick={() => setLineas(lineas.filter((_, i) => i !== n))}>✕</button>
          </div>
        ))}
        {guardar.isError && <div className="alert alert-danger mt-3" role="alert">{mensajeError(guardar.error)}</div>}
        <button className="btn btn-acento w-100 mt-3" disabled={guardar.isPending}>{guardar.isPending ? 'Registrando…' : 'Registrar pedido'}</button>
      </form>
      {nuevoProveedor && <FormProveedor proveedor={null} onCerrar={() => setNuevoProveedor(false)} onGuardado={(p) => setProveedorId(p.id)} />}
    </>
  );
}
