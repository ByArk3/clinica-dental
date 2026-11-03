import { useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insumoNuevoSchema, insumoSchema, type InsumoDTO, type InsumoNuevoDTO } from '@clinica/shared';
import { insumosApi, type Insumo, type MovimientoKardex } from '../api/recursos';
import { FiltroLista } from '../components/FiltroLista';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { mensajeError } from '../formato';

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
  const [cambiarEstado, setCambiarEstado] = useState<Insumo | null>(null);

  const lista = useQuery({ queryKey: ['insumos', q, estado, soloBajos], queryFn: () => insumosApi.listar({ q, activo: estado, bajoMinimo: soloBajos ? '1' : undefined }) });
  const alertas = useQuery({ queryKey: ['alertas'], queryFn: insumosApi.alertas });
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
      {!!alertas.data?.length && (
        <div className="alert alert-warning">
          <strong>{alertas.data.length} insumo(s) en stock mínimo:</strong> {alertas.data.map((a) => a.insumo.nombre).join(', ')}. Deben pedirse (RN-14).
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
      {editando && <FormInsumo insumo={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
      {kardexDe && <ModalKardex insumo={kardexDe} onCerrar={() => setKardexDe(null)} />}
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
          <button className="btn btn-acento" disabled={guardar.isPending}>Guardar</button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

function ModalKardex({ insumo, onCerrar }: { insumo: Insumo; onCerrar: () => void }) {
  const k = useQuery({ queryKey: ['kardex', insumo.id], queryFn: () => insumosApi.kardex(insumo.id) });
  const fmt = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <Modal show onHide={onCerrar} centered size="lg">
      <Modal.Header closeButton><Modal.Title className="h5">Kárdex — {insumo.nombre}</Modal.Title></Modal.Header>
      <Modal.Body>
        <div className="table-responsive">
          <table className="table table-sm mb-0">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th className="text-end">Cantidad</th><th className="text-end">Saldo</th><th>Detalle</th></tr></thead>
            <tbody>
              {k.data?.movimientos.map((m) => (
                <tr key={m.id}>
                  <td className="text-nowrap">{fmt.format(new Date(m.fecha))}</td>
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
