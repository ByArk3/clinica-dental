import { useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LARGO_NUMERICO, proveedorSchema, soloDigitos } from '@clinica/shared';
import { proveedoresApi, type Proveedor } from '../api/recursos';
import { FiltroLista } from '../components/FiltroLista';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { camposApi, erroresZod, mensajeError } from '../formato';

/** CU-26 Registrar · CU-27 Listar · CU-28 Modificar · CU-29 Desactivar proveedores. */
export default function Proveedores() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('1');
  const [editando, setEditando] = useState<Proveedor | 'nuevo' | null>(null);
  const [cambiar, setCambiar] = useState<Proveedor | null>(null);
  const lista = useQuery({ queryKey: ['proveedores', q, estado], queryFn: () => proveedoresApi.listar({ q, activo: estado }) });
  const estadoMut = useMutation({
    mutationFn: (p: Proveedor) => proveedoresApi.cambiarEstado(p.id, !p.activo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proveedores'] }); setCambiar(null); },
  });

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Proveedores</h1>
        <button className="btn btn-acento" onClick={() => setEditando('nuevo')}>+ Registrar proveedor</button>
      </div>
      <FiltroLista q={q} onQ={setQ} estado={estado} onEstado={setEstado} />
      <div className="tarjeta p-0">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead><tr><th>Razón social</th><th>RUC</th><th>Contacto</th><th></th></tr></thead>
            <tbody>
              {lista.data?.map((p) => (
                <tr key={p.id} className={p.activo ? '' : 'text-muted'}>
                  <td>{p.razonSocial} {!p.activo && <span className="badge text-bg-secondary">Desactivado</span>}</td>
                  <td>{p.ruc}</td>
                  <td className="small">{[p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-end text-nowrap">
                    <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEditando(p)}>Modificar</button>
                    <button className={`btn btn-sm ${p.activo ? 'btn-outline-danger' : 'btn-outline-success'}`} onClick={() => setCambiar(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}
              {lista.data?.length === 0 && <tr><td colSpan={4} className="text-muted">Sin resultados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editando && <FormProveedor proveedor={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
      <ModalConfirmar
        abierto={!!cambiar}
        titulo={cambiar?.activo ? 'Desactivar proveedor' : 'Activar proveedor'}
        textoConfirmar={cambiar?.activo ? 'Desactivar' : 'Activar'}
        peligro={cambiar?.activo}
        procesando={estadoMut.isPending}
        error={estadoMut.isError ? mensajeError(estadoMut.error) : null}
        onConfirmar={() => cambiar && estadoMut.mutate(cambiar)}
        onCerrar={() => { setCambiar(null); estadoMut.reset(); }}
      >
        <p className="mb-0">¿{cambiar?.activo ? 'Desactivar' : 'Activar'} a «{cambiar?.razonSocial}»?</p>
      </ModalConfirmar>
    </>
  );
}

export function FormProveedor({ proveedor, onCerrar, onGuardado }: { proveedor: Proveedor | null; onCerrar: () => void; onGuardado?: (p: Proveedor) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    ruc: proveedor?.ruc ?? '',
    razonSocial: proveedor?.razonSocial ?? '',
    contacto: proveedor?.contacto ?? '',
    telefono: proveedor?.telefono ?? '',
    email: proveedor?.email ?? '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof proveedoresApi.crear>[0]) => (proveedor ? proveedoresApi.modificar(proveedor.id, d) : proveedoresApi.crear(d)),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['proveedores'] }); onGuardado?.(p); onCerrar(); },
    onError: (e) => setErrores(camposApi(e)),
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = proveedorSchema.safeParse(v);
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }
  // Autocompletar la razón social con el RUC (SUNAT), solo al registrar uno nuevo y si hay proveedor configurado
  const [sunat, setSunat] = useState<{ estado: 'buscando' | 'ok' | 'sin_datos' | 'no_disponible'; aviso?: string | null } | null>(null);
  async function consultarRuc(ruc: string) {
    setSunat({ estado: 'buscando' });
    try {
      const r = await proveedoresApi.sunat(ruc);
      if (r.encontrado) {
        setV((x) => ({ ...x, razonSocial: x.razonSocial || r.razonSocial }));
        setSunat({ estado: 'ok', aviso: r.aviso });
      } else setSunat(r.motivo === 'no_configurado' ? null : { estado: r.motivo === 'no_encontrado' ? 'sin_datos' : 'no_disponible' });
    } catch {
      setSunat(null);
    }
  }
  const largo: Partial<Record<keyof typeof v, number>> = { ruc: LARGO_NUMERICO.ruc, telefono: LARGO_NUMERICO.celular };
  const cambiar = (k: keyof typeof v, valor: string) => {
    const max = largo[k];
    const limpio = max ? soloDigitos(valor, max) : valor;
    setV({ ...v, [k]: limpio });
    if (k === 'ruc' && !proveedor && limpio.length === LARGO_NUMERICO.ruc && limpio !== v.ruc) void consultarRuc(limpio);
    if (k === 'ruc' && limpio.length < LARGO_NUMERICO.ruc) setSunat(null);
  };
  const campo = (k: keyof typeof v, etiqueta: string, col: string) => (
    <div className={col}>
      <label htmlFor={`p-${k}`} className="form-label">{etiqueta}</label>
      <input id={`p-${k}`} inputMode={largo[k] ? 'numeric' : undefined} maxLength={largo[k]} className={`form-control ${errores[k] ? 'is-invalid' : ''}`} value={v[k]} onChange={(e) => cambiar(k, e.target.value)} />
      <div className="invalid-feedback">{errores[k]}</div>
    </div>
  );
  return (
    <Modal show onHide={onCerrar} centered>
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">{proveedor ? 'Modificar proveedor' : 'Registrar proveedor'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="row g-3">
            {campo('ruc', 'RUC', 'col-sm-5')}
            {campo('razonSocial', 'Razón social', 'col-sm-7')}
            {sunat && (
              <div className="col-12 small" role="status">
                {sunat.estado === 'buscando' && <span className="text-muted">Buscando la razón social en SUNAT…</span>}
                {sunat.estado === 'ok' && <span className="text-success">Razón social completada con SUNAT. Verifíquela.</span>}
                {sunat.estado === 'sin_datos' && <span className="text-muted">SUNAT no devolvió datos para ese RUC; escríbala a mano.</span>}
                {sunat.estado === 'no_disponible' && <span className="text-muted">No se pudo consultar SUNAT ahora; escriba la razón social a mano.</span>}
                {sunat.aviso && <div className="text-danger fw-semibold mt-1">⚠ {sunat.aviso}</div>}
              </div>
            )}
            {campo('contacto', 'Contacto (opcional)', 'col-sm-6')}
            {campo('telefono', 'Teléfono (opcional)', 'col-sm-6')}
            {campo('email', 'Correo (opcional; para enviar pedidos)', 'col-12')}
          </div>
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
