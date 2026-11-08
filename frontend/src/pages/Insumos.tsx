import { useCallback, useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITE_TEXTO, ajusteSchema, insumoNuevoSchema, insumoSchema, limpiarDecimal, soloLetrasSimples, type InsumoDTO, type InsumoNuevoDTO } from '@clinica/shared';
import { Link } from 'react-router-dom';
import { insumosApi, type Insumo, type MovimientoKardex } from '../api/recursos';
import { FiltroLista } from '../components/FiltroLista';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { AvisoFlotante, BotonAccion } from '../components/Interaccion';
import { camposApi, erroresZod, fechaHoraPE, mensajeError } from '../formato';
import { hoyEnLima } from '@clinica/shared';

const num = (s: string) => Number(s).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const TIPO: Record<MovimientoKardex['tipo'], string> = {
  inicial: 'Inventario inicial',
  entrada_recepcion: 'Entrada (recepción)',
  salida_tratamiento: 'Salida (tratamiento)',
  ajuste: 'Ajuste',
  merma: 'Merma',
};

/** CU-18 Registrar · CU-19 Listar · CU-21 Modificar (con CU-25 Corregir stock) · CU-22 Desactivar insumos. */
export default function Insumos() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('1');
  const [soloBajos, setSoloBajos] = useState(false);
  const [editando, setEditando] = useState<Insumo | 'nuevo' | null>(null);
  const [kardexDe, setKardexDe] = useState<Insumo | null>(null);
  // «Modificar» abre una ventana con dos pestañas: datos del insumo (CU-21) y corregir stock (CU-25)
  const [modificar, setModificar] = useState<{ insumo: Insumo; pestana: 'datos' | 'stock' } | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const quitarHecho = useCallback(() => setHecho(null), []);
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
                    <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setModificar({ insumo: i, pestana: 'datos' })}>Modificar</button>
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
      {editando === 'nuevo' && <ModalRegistrar onCerrar={() => setEditando(null)} onHecho={setHecho} />}
      {modificar && <ModalModificar insumo={modificar.insumo} pestanaInicial={modificar.pestana} onCerrar={() => setModificar(null)} onHecho={setHecho} />}
      {hecho && <AvisoFlotante icono="✓" duracion={4500} onCerrar={quitarHecho}>{hecho}</AvisoFlotante>}
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

/** Datos del insumo: nombre, unidad y stock mínimo (y stock inicial al registrar). Lo usan «Registrar» y «Modificar». */
function DatosInsumo({ insumo, onCancelar, onGuardado }: { insumo: Insumo | null; onCancelar: () => void; onGuardado: (mensaje: string) => void }) {
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insumos'] });
      qc.invalidateQueries({ queryKey: ['alertas'] });
      onGuardado(insumo ? `Insumo «${v.nombre.trim()}» actualizado` : `Insumo «${v.nombre.trim()}» registrado`);
    },
    onError: (e) => setErrores((e as { datos?: { campos?: Record<string, string> } }).datos?.campos ?? {}),
  });
  const sinCambios = !!insumo && v.nombre.trim() === insumo.nombre && v.unidad.trim() === insumo.unidad && Number(v.stockMinimo) === Number(insumo.stockMinimo);

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
      <input
        id={`i-${k}`}
        inputMode={decimal ? 'decimal' : undefined}
        maxLength={k === 'nombre' ? LIMITE_TEXTO.nombre : undefined}
        className={`form-control ${errores[k] ? 'is-invalid' : ''}`}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: decimal ? limpiarDecimal(e.target.value) : k === 'unidad' ? soloLetrasSimples(e.target.value, 30) : e.target.value })}
      />
      <div className="invalid-feedback">{errores[k]}</div>
    </div>
  );

  return (
    <form onSubmit={enviar} noValidate>
      <Modal.Body>
        <div className="row g-3">
          {campo('nombre', 'Nombre', 'col-12')}
          {campo('unidad', 'Unidad', 'col-sm-4')}
          {campo('stockMinimo', 'Stock mínimo', 'col-sm-4', true)}
          {insumo ? (
            <div className="col-sm-4">
              <span className="form-label d-block">Stock actual</span>
              <div className="form-control-plaintext fw-semibold">{num(insumo.stockActual)} {insumo.unidad}</div>
            </div>
          ) : (
            campo('stockInicial', 'Stock inicial', 'col-sm-4', true)
          )}
        </div>
        {insumo && <p className="small text-muted mt-3 mb-0">El stock se corrige en la pestaña «Corregir stock» (queda en el kárdex con su motivo).</p>}
        {guardar.isError && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-secondary" onClick={onCancelar}>Cancelar</button>
        <BotonAccion mutacion={guardar} disabled={sinCambios} title={sinCambios ? 'No hay cambios' : undefined}>{insumo ? 'Guardar datos' : 'Registrar'}</BotonAccion>
      </Modal.Footer>
    </form>
  );
}

/** CU-18 Registrar insumo. */
function ModalRegistrar({ onCerrar, onHecho }: { onCerrar: () => void; onHecho: (m: string) => void }) {
  return (
    <Modal show onHide={onCerrar} centered>
      <Modal.Header closeButton><Modal.Title className="h5">Registrar insumo</Modal.Title></Modal.Header>
      <DatosInsumo insumo={null} onCancelar={onCerrar} onGuardado={(m) => { onHecho(m); onCerrar(); }} />
    </Modal>
  );
}

/** «Modificar»: CU-21 Modificar insumo y CU-25 Corregir stock («extend»), en dos pestañas de la misma ventana. */
function ModalModificar({ insumo, pestanaInicial, onCerrar, onHecho }: { insumo: Insumo; pestanaInicial: 'datos' | 'stock'; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [pestana, setPestana] = useState(pestanaInicial);
  const terminar = (m: string) => { onHecho(m); onCerrar(); };
  const bajo = Number(insumo.stockActual) <= Number(insumo.stockMinimo);
  return (
    <Modal show onHide={onCerrar} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">
          Modificar insumo
          <div className="small fw-normal text-muted">{insumo.nombre} · stock {num(insumo.stockActual)} {insumo.unidad}{bajo && <span className="badge text-bg-warning ms-2">En stock mínimo</span>}</div>
        </Modal.Title>
      </Modal.Header>
      <div className="px-3 pt-3">
        <ul className="nav nav-pills nav-fill pestanas-insumo">
          <li className="nav-item"><button type="button" className={`nav-link ${pestana === 'datos' ? 'active' : ''}`} aria-pressed={pestana === 'datos'} onClick={() => setPestana('datos')}>Datos del insumo</button></li>
          <li className="nav-item">
            <button type="button" className={`nav-link ${pestana === 'stock' ? 'active' : ''}`} aria-pressed={pestana === 'stock'} onClick={() => setPestana('stock')} disabled={!insumo.activo} title={insumo.activo ? undefined : 'Active el insumo para corregir su stock'}>
              Corregir stock
            </button>
          </li>
        </ul>
      </div>
      {pestana === 'datos' ? <DatosInsumo insumo={insumo} onCancelar={onCerrar} onGuardado={terminar} /> : <CorregirStock insumo={insumo} onCancelar={onCerrar} onGuardado={terminar} />}
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
            <input id="k-desde" type="date" max={hoyEnLima()} className="form-control form-control-sm" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
          </div>
          <div className="col-sm-4">
            <label htmlFor="k-hasta" className="form-label small mb-1">Hasta</label>
            <input id="k-hasta" type="date" max={hoyEnLima()} className="form-control form-control-sm" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
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

/**
 * CU-25 Corregir stock (RN-13: solo el Administrador): «Conteo físico» (se escribe lo que se contó) o «Merma»
 * (vencido o dañado: se escribe lo que se retira). Siempre con motivo; queda en el kárdex con fecha y usuario.
 */
function CorregirStock({ insumo, onCancelar, onGuardado }: { insumo: Insumo; onCancelar: () => void; onGuardado: (mensaje: string) => void }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<'ajuste' | 'merma'>('ajuste');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const actual = Number(insumo.stockActual);
  const n = Number(valor.replace(',', '.'));
  // Conteo: la cantidad contada es el nuevo stock (la diferencia es el ajuste). Merma: lo que se retira.
  const cantidad = tipo === 'merma' ? n : n - actual;
  const resultado = tipo === 'merma' ? actual - n : n;
  const valido = valor !== '' && !Number.isNaN(n);
  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof insumosApi.ajuste>[1]) => insumosApi.ajuste(insumo.id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insumos'] });
      qc.invalidateQueries({ queryKey: ['alertas'] });
      qc.invalidateQueries({ queryKey: ['kardex', insumo.id] });
      onGuardado(`Stock de «${insumo.nombre}» corregido: ${num(String(actual))} → ${num(String(resultado))} ${insumo.unidad}`);
    },
    onError: (e) => setErrores(camposApi(e)),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (tipo === 'ajuste' && valido && cantidad === 0) return setErrores({ cantidad: 'Es igual al stock actual: no hay nada que corregir' });
    if (valido && resultado < 0) return setErrores({ cantidad: 'El stock no puede quedar negativo' });
    const r = ajusteSchema.safeParse({ tipo, cantidad: valido ? cantidad : '', motivo });
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }
  const cambio = valido ? resultado - actual : 0;

  return (
    <form onSubmit={enviar} noValidate>
      <Modal.Body>
        <div className="btn-group w-100 mb-3" role="group" aria-label="Tipo de corrección">
          <button type="button" className={`btn ${tipo === 'ajuste' ? 'btn-acento' : 'btn-outline-secondary'}`} aria-pressed={tipo === 'ajuste'} onClick={() => { setTipo('ajuste'); setValor(''); setErrores({}); }}>
            Conteo físico
          </button>
          <button type="button" className={`btn ${tipo === 'merma' ? 'btn-acento' : 'btn-outline-secondary'}`} aria-pressed={tipo === 'merma'} onClick={() => { setTipo('merma'); setValor(''); setErrores({}); }}>
            Merma (vencido, dañado)
          </button>
        </div>
        <div className="row g-3 align-items-start">
          <div className="col-sm-6">
            <label htmlFor="a-cantidad" className="form-label">{tipo === 'merma' ? `Cantidad a retirar (${insumo.unidad})` : `Cantidad contada (${insumo.unidad})`}</label>
            <input id="a-cantidad" inputMode="decimal" className={`form-control ${errores.cantidad ? 'is-invalid' : ''}`} value={valor} onChange={(e) => setValor(limpiarDecimal(e.target.value))} placeholder={tipo === 'merma' ? 'Ej.: 2' : `Ej.: ${num(String(actual))}`} />
            <div className="invalid-feedback">{errores.cantidad}</div>
            <div className="form-text">{tipo === 'merma' ? 'Lo que se bota o se devuelve.' : 'Lo que hay físicamente en el almacén.'}</div>
          </div>
          <div className="col-sm-6">
            <div className="vista-stock" aria-live="polite">
              <div className="small text-muted mb-1">Stock</div>
              <div className="fs-5">
                <span>{num(String(actual))}</span>
                <span className="mx-2 text-muted" aria-hidden="true">→</span>
                <strong className={valido && resultado < 0 ? 'text-danger' : ''}>{valido ? num(String(resultado)) : '—'}</strong>
                <span className="small text-muted ms-1">{insumo.unidad}</span>
              </div>
              {valido && cambio !== 0 && <span className={`badge ${cambio > 0 ? 'text-bg-success' : 'text-bg-danger'}`}>{cambio > 0 ? '+' : ''}{num(String(cambio))}</span>}
            </div>
          </div>
          <div className="col-12">
            <label htmlFor="a-motivo" className="form-label">Motivo</label>
            <input id="a-motivo" maxLength={LIMITE_TEXTO.motivo} className={`form-control ${errores.motivo ? 'is-invalid' : ''}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'merma' ? 'Ej.: jeringas vencidas en octubre' : 'Ej.: conteo físico mensual'} />
            <div className="invalid-feedback">{errores.motivo}</div>
            <div className="form-text">Queda en el kárdex con la fecha y su usuario.</div>
          </div>
        </div>
        {guardar.isError && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-secondary" onClick={onCancelar}>Cancelar</button>
        <BotonAccion mutacion={guardar}>Guardar corrección</BotonAccion>
      </Modal.Footer>
    </form>
  );
}
