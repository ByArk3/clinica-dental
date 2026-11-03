import { useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { proveedorSchema } from '@clinica/shared';
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
  const campo = (k: keyof typeof v, etiqueta: string, col: string, numerico = false) => (
    <div className={col}>
      <label htmlFor={`p-${k}`} className="form-label">{etiqueta}</label>
      <input id={`p-${k}`} inputMode={numerico ? 'numeric' : undefined} className={`form-control ${errores[k] ? 'is-invalid' : ''}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <div className="invalid-feedback">{errores[k]}</div>
    </div>
  );
  return (
    <Modal show onHide={onCerrar} centered>
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">{proveedor ? 'Modificar proveedor' : 'Registrar proveedor'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="row g-3">
            {campo('ruc', 'RUC', 'col-sm-5', true)}
            {campo('razonSocial', 'Razón social', 'col-sm-7')}
            {campo('contacto', 'Contacto (opcional)', 'col-sm-6')}
            {campo('telefono', 'Teléfono (opcional)', 'col-sm-6', true)}
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
