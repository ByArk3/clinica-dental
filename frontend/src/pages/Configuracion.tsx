import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { descuentoSchema } from '@clinica/shared';
import { configApi, type Descuento } from '../api/recursos';
import { camposApi, erroresZod, mensajeError, solesPE } from '../formato';

/** Descuentos (P3) y monto del adelanto (P6), gestionados por el Administrador. */
export default function Configuracion() {
  const qc = useQueryClient();
  const descuentos = useQuery({ queryKey: ['admin-descuentos'], queryFn: configApi.descuentos });
  const adelanto = useQuery({ queryKey: ['adelanto'], queryFn: configApi.adelanto });
  const [editando, setEditando] = useState<Descuento | null>(null);
  const [v, setV] = useState({ nombre: '', porcentaje: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [monto, setMonto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => { if (adelanto.data) setMonto(String(Number(adelanto.data.monto))); }, [adelanto.data]);

  const guardar = useMutation({
    mutationFn: (d: { nombre: string; porcentaje: number }) => (editando ? configApi.modificarDescuento(editando.id, d) : configApi.crearDescuento(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-descuentos'] }); setEditando(null); setV({ nombre: '', porcentaje: '' }); },
    onError: (e) => setErrores(camposApi(e)),
  });
  const estado = useMutation({
    mutationFn: (d: Descuento) => configApi.estadoDescuento(d.id, !d.activo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-descuentos'] }),
  });
  const guardarAdelanto = useMutation({
    mutationFn: () => configApi.cambiarAdelanto(Number(monto.replace(',', '.'))),
    onSuccess: (r) => { qc.setQueryData(['adelanto'], r); setAviso(`Adelanto actualizado a ${solesPE(r.monto)}`); },
    onError: (e) => setAviso(mensajeError(e)),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = descuentoSchema.safeParse(v);
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }

  return (
    <>
      <h1 className="h4 mb-3">Configuración de caja</h1>
      <div className="row g-3">
        <div className="col-lg-7">
          <div className="tarjeta">
            <h2 className="h6">Descuentos</h2>
            <p className="small text-muted">La recepcionista puede aplicar un descuento activo por cobro, sobre el subtotal del servicio.</p>
            <table className="table table-sm align-middle">
              <tbody>
                {descuentos.data?.map((d) => (
                  <tr key={d.id} className={d.activo ? '' : 'text-muted'}>
                    <td>{d.nombre} {!d.activo && <span className="badge text-bg-secondary">Desactivado</span>}</td>
                    <td className="text-end">{Number(d.porcentaje)} %</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => { setEditando(d); setV({ nombre: d.nombre, porcentaje: String(Number(d.porcentaje)) }); }}>Modificar</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => estado.mutate(d)}>{d.activo ? 'Desactivar' : 'Activar'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form className="row g-2 align-items-end" onSubmit={enviar} noValidate>
              <div className="col-sm-6">
                <label htmlFor="d-nombre" className="form-label small mb-1">{editando ? 'Modificar descuento' : 'Nuevo descuento'}</label>
                <input id="d-nombre" className={`form-control ${errores.nombre ? 'is-invalid' : ''}`} placeholder="Nombre" value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} />
                <div className="invalid-feedback">{errores.nombre}</div>
              </div>
              <div className="col-sm-3">
                <label htmlFor="d-porcentaje" className="form-label small mb-1">%</label>
                <input id="d-porcentaje" inputMode="decimal" className={`form-control ${errores.porcentaje ? 'is-invalid' : ''}`} value={v.porcentaje} onChange={(e) => setV({ ...v, porcentaje: e.target.value })} />
                <div className="invalid-feedback">{errores.porcentaje}</div>
              </div>
              <div className="col-sm-3 d-flex gap-1">
                <button className="btn btn-acento flex-grow-1" disabled={guardar.isPending}>{editando ? 'Guardar' : 'Agregar'}</button>
                {editando && <button type="button" className="btn btn-outline-secondary" aria-label="Cancelar" onClick={() => { setEditando(null); setV({ nombre: '', porcentaje: '' }); setErrores({}); }}>✕</button>}
              </div>
            </form>
            {guardar.isError && !Object.keys(errores).length && <div className="alert alert-danger mt-2 mb-0">{mensajeError(guardar.error)}</div>}
          </div>
        </div>
        <div className="col-lg-5">
          <form className="tarjeta" onSubmit={(e) => { e.preventDefault(); guardarAdelanto.mutate(); }}>
            <h2 className="h6">Adelanto obligatorio (RN-12)</h2>
            <p className="small text-muted">Lo paga en caja el paciente con 3 o más inasistencias para que su cita siga el flujo de confirmación. Se descuenta del cobro final.</p>
            <label htmlFor="monto-adelanto" className="form-label">Monto (S/)</label>
            <div className="d-flex gap-2">
              <input id="monto-adelanto" inputMode="decimal" className="form-control" value={monto} onChange={(e) => setMonto(e.target.value)} />
              <button className="btn btn-acento" disabled={guardarAdelanto.isPending}>Guardar</button>
            </div>
            {aviso && <div className="small mt-2">{aviso}</div>}
          </form>
        </div>
      </div>
    </>
  );
}
