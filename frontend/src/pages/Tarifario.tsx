import { useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITE_TEXTO, limpiarDecimal, tratamientoSchema } from '@clinica/shared';
import { insumosApi, tarifarioApi, type Tratamiento } from '../api/recursos';
import { FiltroLista } from '../components/FiltroLista';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { BotonAccion } from '../components/Interaccion';
import { mensajeError, solesPE } from '../formato';

interface LineaInsumo { insumoId: number | ''; cantidad: string }

/** CU-14 Agregar · CU-15 Listar · CU-16 Modificar · CU-17 Desactivar (tarifario). */
export default function Tarifario() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('1');
  const [editando, setEditando] = useState<Tratamiento | 'nuevo' | null>(null);
  const [cambiarEstado, setCambiarEstado] = useState<Tratamiento | null>(null);

  const lista = useQuery({ queryKey: ['tarifario', q, estado], queryFn: () => tarifarioApi.listar({ q, activo: estado }) });
  const estadoMut = useMutation({
    mutationFn: (t: Tratamiento) => tarifarioApi.cambiarEstado(t.id, !t.activo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tarifario'] }); setCambiarEstado(null); },
  });

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Tarifario</h1>
        <button className="btn btn-acento" onClick={() => setEditando('nuevo')}>+ Agregar tratamiento</button>
      </div>
      <FiltroLista q={q} onQ={setQ} estado={estado} onEstado={setEstado} />
      <div className="tarjeta p-0">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr><th>Tratamiento</th><th className="text-end">Precio</th><th>Insumos que consume</th><th></th></tr>
            </thead>
            <tbody>
              {lista.data?.map((t) => (
                <tr key={t.id} className={t.activo ? '' : 'text-muted'}>
                  <td>{t.nombre} {!t.activo && <span className="badge text-bg-secondary">Desactivado</span>}</td>
                  <td className="text-end text-nowrap">{solesPE(t.precio)}</td>
                  <td className="small">{t.insumos.map((i) => `${i.nombre} ×${Number(i.cantidad)}`).join(' · ') || '—'}</td>
                  <td className="text-end text-nowrap">
                    <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEditando(t)}>Modificar</button>
                    <button className={`btn btn-sm ${t.activo ? 'btn-outline-danger' : 'btn-outline-success'}`} onClick={() => setCambiarEstado(t)}>
                      {t.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
              {lista.data?.length === 0 && <tr><td colSpan={4} className="text-muted">Sin resultados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editando && <FormTratamiento tratamiento={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
      <ModalConfirmar
        abierto={!!cambiarEstado}
        titulo={cambiarEstado?.activo ? 'Desactivar tratamiento' : 'Activar tratamiento'}
        textoConfirmar={cambiarEstado?.activo ? 'Desactivar' : 'Activar'}
        peligro={cambiarEstado?.activo}
        procesando={estadoMut.isPending}
        error={estadoMut.isError ? mensajeError(estadoMut.error) : null}
        onConfirmar={() => cambiarEstado && estadoMut.mutate(cambiarEstado)}
        onCerrar={() => { setCambiarEstado(null); estadoMut.reset(); }}
      >
        {cambiarEstado?.activo
          ? <p className="mb-0">«{cambiarEstado.nombre}» dejará de estar disponible para nuevas atenciones. Las atenciones anteriores no cambian.</p>
          : <p className="mb-0">«{cambiarEstado?.nombre}» volverá a estar disponible.</p>}
      </ModalConfirmar>
    </>
  );
}

function FormTratamiento({ tratamiento, onCerrar }: { tratamiento: Tratamiento | null; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(tratamiento?.nombre ?? '');
  const [precio, setPrecio] = useState(tratamiento ? String(Number(tratamiento.precio)) : '');
  const [lineas, setLineas] = useState<LineaInsumo[]>(tratamiento?.insumos.map((i) => ({ insumoId: i.insumoId, cantidad: String(Number(i.cantidad)) })) ?? []);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const insumos = useQuery({ queryKey: ['insumos-activos'], queryFn: () => insumosApi.listar({ activo: '1' }) });

  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof tarifarioApi.crear>[0]) => (tratamiento ? tarifarioApi.modificar(tratamiento.id, d) : tarifarioApi.crear(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tarifario'] }); onCerrar(); },
    onError: (e) => setErrores((e as { datos?: { campos?: Record<string, string> } }).datos?.campos ?? {}),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const v = tratamientoSchema.safeParse({ nombre, precio, insumos: lineas.map((l) => ({ insumoId: l.insumoId || 0, cantidad: l.cantidad })) });
    if (!v.success) {
      const c: Record<string, string> = {};
      for (const i of v.error.issues) c[i.path.join('.')] ??= i.message;
      return setErrores(c);
    }
    setErrores({});
    guardar.mutate(v.data);
  }
  const cambiar = (n: number, c: Partial<LineaInsumo>) => setLineas((ls) => ls.map((l, i) => (i === n ? { ...l, ...c } : l)));

  return (
    <Modal show onHide={onCerrar} centered size="lg">
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">{tratamiento ? 'Modificar tratamiento' : 'Agregar tratamiento'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="row g-3 mb-3">
            <div className="col-sm-8">
              <label htmlFor="t-nombre" className="form-label">Nombre</label>
              <input id="t-nombre" maxLength={LIMITE_TEXTO.nombre} className={`form-control ${errores.nombre ? 'is-invalid' : ''}`} value={nombre} onChange={(e) => setNombre(e.target.value)} />
              <div className="invalid-feedback">{errores.nombre}</div>
            </div>
            <div className="col-sm-4">
              <label htmlFor="t-precio" className="form-label">Precio (S/)</label>
              <input id="t-precio" inputMode="decimal" placeholder="0.00" className={`form-control ${errores.precio ? 'is-invalid' : ''}`} value={precio} onChange={(e) => setPrecio(limpiarDecimal(e.target.value))} />
              <div className="invalid-feedback">{errores.precio}</div>
            </div>
          </div>
          {tratamiento && <p className="small text-muted">El nuevo precio solo se aplica a las atenciones futuras.</p>}
          <span className="form-label d-block">Insumos que consume</span>
          {errores.insumos && <div className="text-danger small mb-2">{errores.insumos}</div>}
          {lineas.length > 0 && (
            <div className="d-flex gap-2 mb-1 small text-muted fw-semibold encabezado-insumos" aria-hidden="true">
              <span className="flex-grow-1">Insumo</span>
              <span style={{ width: 170 }}>Cantidad</span>
              <span style={{ width: 42 }} />
            </div>
          )}
          {lineas.map((l, n) => (
            <div className="d-flex gap-2 mb-2 align-items-center" key={n}>
              <select aria-label={`Insumo ${n + 1}`} className={`form-select ${errores[`insumos.${n}.insumoId`] ? 'is-invalid' : ''}`} value={l.insumoId} onChange={(e) => cambiar(n, { insumoId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Seleccione…</option>
                {insumos.data?.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>)}
              </select>
              <div className="input-group" style={{ width: 170, flex: '0 0 auto' }}>
                <input aria-label={`Cantidad ${n + 1}`} inputMode="decimal" className={`form-control ${errores[`insumos.${n}.cantidad`] ? 'is-invalid' : ''}`} value={l.cantidad} onChange={(e) => cambiar(n, { cantidad: limpiarDecimal(e.target.value) })} placeholder="1" />
                <span className="input-group-text small">{insumos.data?.find((i) => i.id === l.insumoId)?.unidad ?? 'unid.'}</span>
              </div>
              <button type="button" className="btn btn-outline-secondary" aria-label={`Quitar insumo ${n + 1}`} onClick={() => setLineas((ls) => ls.filter((_, i) => i !== n))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setLineas((ls) => [...ls, { insumoId: '', cantidad: '1' }])}>+ Agregar insumo</button>
          {guardar.isError && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>Cancelar</button>
          <BotonAccion mutacion={guardar}>Guardar</BotonAccion>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
