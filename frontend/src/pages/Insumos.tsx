import { useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ajusteSchema, insumoNuevoSchema, insumoSchema, type InsumoDTO, type InsumoNuevoDTO } from '@clinica/shared';
import { Link } from 'react-router-dom';
import { insumosApi, type Insumo, type MovimientoKardex } from '../api/recursos';
import { FiltroLista } from '../components/FiltroLista';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { BotonAccion } from '../components/Interaccion';
import { camposApi, erroresZod, fechaHoraPE, mensajeError } from '../formato';

const num = (s: string) => Number(s).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const TIPO: Record<MovimientoKardex['tipo'], string> = {
  inicial: 'Inventario inicial',
  entrada_recepcion: 'Entrada (recepción)',
  salida_tratamiento: 'Salida (tratamiento)',
  ajuste: 'Ajuste',
  merma: 'Merma',
};

/** CU-18 Registrar · CU-19 Listar · CU-20 Modificar · CU-21 Desactivar insumos. */
export default function Insumos() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('1');
  const [soloBajos, setSoloBajos] = useState(false);
  const [editando, setEditando] = useState<Insumo | 'nuevo' | null>(null);
  const [kardexDe, setKardexDe] = useState<Insumo | null>(null);
  const [ajusteDe, setAjusteDe] = useState<Insumo | null>(null);
  const [cambiarEstado, setCambiarEstado] = useState<Insumo | null>(null);

  const lista = useQuery({ queryKey: ['insumos', q, estado, soloBajos], queryFn: () => insumosApi.listar({ q, activo: estado, bajoMinimo: soloBajos ? '1' : undefined }) });
  const alertas = useQuery({ queryKey: ['alertas'], queryFn: () => insumosApi.alertas() });
  // El aviso cuenta lo mismo que la tabla: todos los insumos activos en el mínimo o por debajo
  const bajos = useQuery({ queryKey: ['insumos', 'bajos'], queryFn: () => insumosApi.listar({ activo: '1', bajoMinimo: '1' }) });
  const estadoMut = useMutation({
    mutationFn: (i: Insumo) => insumosApi.cambiarEstado(i.id, !i.activo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insumos'] }); setCambiarEstado(null); },
  });

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Insumos</h1>
        <button className="btn btn-acento" onClick={() => setEditando('nuevo')}>+ Registrar insumo</button>
      </div>
      {!!bajos.data?.length && (
        <div className="alert alert-warning">
          <strong>{bajos.data.length} insumo(s) en stock mínimo:</strong> {bajos.data.map((i) => i.nombre).join(', ')}. Deben pedirse (RN-14).
          {' '}<strong>{alertas.data?.length ?? 0} alerta(s) sin revisar.</strong>{' '}
          <Link to="/alertas">Revisar alertas</Link>
        </div>
      )}
      <FiltroLista
        q={q}
        onQ={setQ}
        estado={estado}
        onEstado={setEstado}
        extra={
          <div className="form-check align-self-center ms-1">
            <input id="solo-bajos" type="checkbox" className="form-check-input" checked={soloBajos} onChange={(e) => setSoloBajos(e.target.checked)} />
            <label htmlFor="solo-bajos" className="form-check-label">Solo en stock mínimo</label>
          </div>
        }
      />
      <div className="tarjeta p-0">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr><th>Insumo</th><th>Unidad</th><th className="text-end">Stock</th><th className="text-end">Mínimo</th><th></th></tr>
            </thead>
            <tbody>
              {lista.data?.map((i) => (
                <tr key={i.id} className={!i.activo ? 'text-muted' : i.bajoMinimo ? 'table-warning' : ''}>
                  <td>{i.nombre} {!i.activo && <span className="badge text-bg-secondary">Desactivado</span>}</td>
                  <td>{i.unidad}</td>
                  <td className="text-end fw-semibold">{num(i.stockActual)}</td>
                  <td className="text-end">{num(i.stockMinimo)}</td>
                  <td className="text-end text-nowrap">
                    <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setKardexDe(i)}>Kárdex</button>
                    {i.activo && <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setAjusteDe(i)}>Ajuste</button>}
                    <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEditando(i)}>Modificar</button>
                    <button className={`btn btn-sm ${i.activo ? 'btn-outline-danger' : 'btn-outline-success'}`} onClick={() => setCambiarEstado(i)}>
                      {i.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
              {lista.data?.length === 0 && <tr><td colSpan={5} className="text-muted">Sin resultados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small text-muted mt-2"><span className="leyenda-bajo-minimo" aria-hidden="true" /> Fila naranja = stock igual o menor al mínimo (RN-14).</p>
      {editando && <FormInsumo insumo={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
      {kardexDe && <ModalKardex insumo={kardexDe} onCerrar={() => setKardexDe(null)} />}
      {ajusteDe && <ModalAjuste insumo={ajusteDe} onCerrar={() => setAjusteDe(null)} />}
      <ModalConfirmar
        abierto={!!cambiarEstado}
        titulo={cambiarEstado?.activo ? 'Desactivar insumo' : 'Activar insumo'}
        textoConfirmar={cambiarEstado?.activo ? 'Desactivar' : 'Activar'}
        peligro={cambiarEstado?.activo}
        procesando={estadoMut.isPending}
        error={estadoMut.isError ? mensajeError(estadoMut.error) : null}
        onConfirmar={() => cambiarEstado && estadoMut.mutate(cambiarEstado)}
        onCerrar={() => { setCambiarEstado(null); estadoMut.reset(); }}
      >
        <p className="mb-0">{cambiarEstado?.activo ? `¿Desactivar «${cambiarEstado.nombre}»? Su historial se conserva.` : `¿Activar «${cambiarEstado?.nombre}»?`}</p>
      </ModalConfirmar>
    </>
  );
}

function FormInsumo({ insumo, onCerrar }: { insumo: Insumo | null; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    nombre: insumo?.nombre ?? '',
    unidad: insumo?.unidad ?? '',
    stockMinimo: insumo ? String(Number(insumo.stockMinimo)) : '',
    stockInicial: '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const guardar = useMutation({
    mutationFn: (d: InsumoDTO | InsumoNuevoDTO) =>
      insumo ? insumosApi.modificar(insumo.id, d) : insumosApi.crear(d as InsumoNuevoDTO),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insumos'] }); qc.invalidateQueries({ queryKey: ['alertas'] }); onCerrar(); },
    onError: (e) => setErrores((e as { datos?: { campos?: Record<string, string> } }).datos?.campos ?? {}),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = (insumo ? insumoSchema : insumoNuevoSchema).safeParse(v);
    if (!r.success) {
      const c: Record<string, string> = {};
      for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
      return setErrores(c);
    }
    setErrores({});
    guardar.mutate(r.data);
  }
  const campo = (k: keyof typeof v, etiqueta: string, col: string, decimal = false) => (
    <div className={col}>
      <label htmlFor={`i-${k}`} className="form-label">{etiqueta}</label>
      <input id={`i-${k}`} inputMode={decimal ? 'decimal' : undefined} className={`form-control ${errores[k] ? 'is-invalid' : ''}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <div className="invalid-feedback">{errores[k]}</div>
    </div>
  );

  return (
    <Modal show onHide={onCerrar} centered>
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">{insumo ? 'Modificar insumo' : 'Registrar insumo'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="row g-3">
            {campo('nombre', 'Nombre', 'col-12')}
            {campo('unidad', 'Unidad', 'col-sm-4')}
            {campo('stockMinimo', 'Stock mínimo', 'col-sm-4', true)}
            {insumo ? (
              <div className="col-sm-4">
                <span className="form-label d-block">Stock actual</span>
                <div className="form-control-plaintext fw-semibold">{num(insumo.stockActual)}</div>
              </div>
            ) : (
              campo('stockInicial', 'Stock inicial', 'col-sm-4', true)
            )}
          </div>
          {insumo && <p className="small text-muted mt-2 mb-0">El stock actual solo cambia por recepción de pedidos o ajustes de stock.</p>}
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

/** CU-23 Consultar kárdex (filtros por fecha y tipo de movimiento). */
function ModalKardex({ insumo, onCerrar }: { insumo: Insumo; onCerrar: () => void }) {
  const [f, setF] = useState({ desde: '', hasta: '', tipo: '' });
  const k = useQuery({ queryKey: ['kardex', insumo.id, f], queryFn: () => insumosApi.kardex(insumo.id, f) });
  return (
    <Modal show onHide={onCerrar} centered size="lg">
      <Modal.Header closeButton><Modal.Title className="h5">Kárdex — {insumo.nombre}</Modal.Title></Modal.Header>
      <Modal.Body>
        <div className="row g-2 mb-3">
          <div className="col-sm-4">
            <label htmlFor="k-desde" className="form-label small mb-1">Desde</label>
            <input id="k-desde" type="date" className="form-control form-control-sm" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
          </div>
          <div className="col-sm-4">
            <label htmlFor="k-hasta" className="form-label small mb-1">Hasta</label>
            <input id="k-hasta" type="date" className="form-control form-control-sm" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
          </div>
          <div className="col-sm-4">
            <label htmlFor="k-tipo" className="form-label small mb-1">Movimiento</label>
            <select id="k-tipo" className="form-select form-select-sm" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="">Todos</option>
              {Object.entries(TIPO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
        </div>
        {k.data?.movimientos.length === 0 && <p className="text-muted small">Sin movimientos para el filtro elegido.</p>}
        <div className="table-responsive">
          <table className="table table-sm mb-0">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th className="text-end">Cantidad</th><th className="text-end">Saldo</th><th>Detalle</th></tr></thead>
            <tbody>
              {k.data?.movimientos.map((m) => (
                <tr key={m.id}>
                  <td className="text-nowrap">{fechaHoraPE(m.fecha)}</td>
                  <td>{TIPO[m.tipo]}</td>
                  <td className={`text-end ${Number(m.cantidad) < 0 ? 'text-danger' : 'text-success'}`}>{Number(m.cantidad) > 0 ? '+' : ''}{num(m.cantidad)}</td>
                  <td className="text-end fw-semibold">{num(m.saldo)}</td>
                  <td className="small">{m.motivo}<div className="text-muted">{m.usuario}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal.Body>
    </Modal>
  );
}

/** CU-25 Registrar ajuste de stock o merma (RN-13: solo el Administrador). */
function ModalAjuste({ insumo, onCerrar }: { insumo: Insumo; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<'ajuste' | 'merma'>('ajuste');
  const [sentido, setSentido] = useState<1 | -1>(1);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof insumosApi.ajuste>[1]) => insumosApi.ajuste(insumo.id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insumos'] });
      qc.invalidateQueries({ queryKey: ['alertas'] });
      qc.invalidateQueries({ queryKey: ['kardex', insumo.id] });
      onCerrar();
    },
    onError: (e) => setErrores(camposApi(e)),
  });
  const n = Number(cantidad.replace(',', '.'));
  const resultado = Number(insumo.stockActual) + (tipo === 'merma' ? -n : sentido * n);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = ajusteSchema.safeParse({ tipo, cantidad: tipo === 'merma' ? n : sentido * n, motivo });
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }

  return (
    <Modal show onHide={onCerrar} centered>
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">Ajuste de stock — {insumo.nombre}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="btn-group w-100 mb-3" role="group" aria-label="Tipo de movimiento">
            <button type="button" className={`btn ${tipo === 'ajuste' ? 'btn-acento' : 'btn-outline-secondary'}`} onClick={() => setTipo('ajuste')}>Ajuste (conteo físico)</button>
            <button type="button" className={`btn ${tipo === 'merma' ? 'btn-acento' : 'btn-outline-secondary'}`} onClick={() => setTipo('merma')}>Merma (vencido, dañado)</button>
          </div>
          {tipo === 'ajuste' && (
            <div className="btn-group mb-3" role="group" aria-label="Sentido">
              <button type="button" className={`btn btn-sm ${sentido === 1 ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setSentido(1)}>Sumar</button>
              <button type="button" className={`btn btn-sm ${sentido === -1 ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setSentido(-1)}>Restar</button>
            </div>
          )}
          <div className="row g-3">
            <div className="col-sm-5">
              <label htmlFor="a-cantidad" className="form-label">Cantidad ({insumo.unidad})</label>
              <input id="a-cantidad" inputMode="decimal" className={`form-control ${errores.cantidad ? 'is-invalid' : ''}`} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              <div className="invalid-feedback">{errores.cantidad}</div>
            </div>
            <div className="col-sm-7">
              <span className="form-label d-block">Stock</span>
              <div className="form-control-plaintext">
                {num(insumo.stockActual)} → <strong className={resultado < 0 ? 'text-danger' : ''}>{cantidad ? num(String(resultado)) : '—'}</strong>
              </div>
            </div>
            <div className="col-12">
              <label htmlFor="a-motivo" className="form-label">Motivo</label>
              <input id="a-motivo" className={`form-control ${errores.motivo ? 'is-invalid' : ''}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: conteo físico mensual, jeringas vencidas" />
              <div className="invalid-feedback">{errores.motivo}</div>
            </div>
          </div>
          {guardar.isError && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>Cancelar</button>
          <BotonAccion mutacion={guardar}>Registrar</BotonAccion>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
