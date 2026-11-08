import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ACCIONES_AUDITORIA, ETIQUETA_AUDITORIA, rangoFechasSchema, type Rol } from '@clinica/shared';
import { auditoriaApi, usuariosApi } from '../api/recursos';
import { fechaHoraPE, hoyLima, mensajeError } from '../formato';
import { DniPaciente } from '../components/DniPaciente';
import { hoyEnLima } from '@clinica/shared';

const ROL_PE: Record<Rol, string> = { paciente: 'Paciente', recepcionista: 'Recepcionista', odontologo: 'Odontólogo', administrador: 'Administrador' };

/** Auditoría: quién vio el historial clínico de cada paciente y cuándo; ediciones, anulaciones y bloqueos. */
export default function Auditoria() {
  const hoy = hoyLima();
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const [dni, setDni] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [accion, setAccion] = useState('');
  const rango = rangoFechasSchema.safeParse({ desde, hasta });
  const dniValido = dni === '' || /^\d{8}$/.test(dni);
  const usuarios = useQuery({ queryKey: ['usuarios', 'personal'], queryFn: () => usuariosApi.listar({}), staleTime: 5 * 60_000 });
  const eventos = useQuery({
    queryKey: ['auditoria', desde, hasta, dni, usuarioId, accion],
    queryFn: () => auditoriaApi.listar({ desde, hasta, dni, usuarioId, accion }),
    enabled: rango.success && dniValido,
  });

  return (
    <>
      <h1 className="h4 mb-1">Auditoría</h1>
      <p className="text-muted small mb-3">Accesos al historial clínico, correcciones de atenciones, anulaciones de comprobantes y bloqueos de inicio de sesión.</p>
      <div className="tarjeta mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-6 col-md-2"><label htmlFor="a-desde" className="form-label small mb-1">Desde</label><input id="a-desde" type="date" max={hoyEnLima()} className="form-control" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} /></div>
          <div className="col-6 col-md-2"><label htmlFor="a-hasta" className="form-label small mb-1">Hasta</label><input id="a-hasta" type="date" max={hoyEnLima()} className="form-control" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} /></div>
          <div className="col-12 col-md-2">
            <label htmlFor="a-dni" className="form-label small mb-1">DNI del paciente</label>
            <input id="a-dni" inputMode="numeric" maxLength={8} className={`form-control ${dniValido ? '' : 'is-invalid'}`} value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))} />
            <div className="invalid-feedback">El DNI tiene 8 dígitos</div>
          </div>
          <div className="col-12 col-md-3">
            <label htmlFor="a-usuario" className="form-label small mb-1">Usuario</label>
            <select id="a-usuario" className="form-select" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
              <option value="">Todos</option>
              {usuarios.data?.filter((u) => u.rol !== 'paciente').map((u) => <option key={u.id} value={u.id}>{u.nombres} ({ROL_PE[u.rol]})</option>)}
            </select>
          </div>
          <div className="col-12 col-md-3">
            <label htmlFor="a-accion" className="form-label small mb-1">Acción</label>
            <select id="a-accion" className="form-select" value={accion} onChange={(e) => setAccion(e.target.value)}>
              <option value="">Todas</option>
              {ACCIONES_AUDITORIA.map((a) => <option key={a} value={a}>{ETIQUETA_AUDITORIA[a]}</option>)}
            </select>
          </div>
        </div>
      </div>
      {!rango.success && <div className="alert alert-warning">{rango.error.issues[0].message}</div>}
      {eventos.isError && <div className="alert alert-danger">{mensajeError(eventos.error)}</div>}
      {eventos.isLoading && <p className="text-muted">Cargando…</p>}
      {eventos.data && (
        <div className="tarjeta p-0">
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0 small">
              <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Paciente</th><th>Detalle</th></tr></thead>
              <tbody>
                {eventos.data.eventos.map((e) => (
                  <tr key={e.id}>
                    <td className="text-nowrap">{fechaHoraPE(e.fecha)}</td>
                    <td>{e.usuario ? <>{e.usuario.nombres}<div className="text-muted">{ROL_PE[e.usuario.rol]}</div></> : <span className="text-muted">—</span>}</td>
                    <td>{ETIQUETA_AUDITORIA[e.accion]}</td>
                    <td>{e.paciente ? <>{e.paciente.nombres}<div className="text-muted"><DniPaciente dni={e.paciente.dni} /></div></> : <span className="text-muted">—</span>}</td>
                    <td className="text-break">{e.detalle ?? ''}{e.ip && <div className="text-muted">IP {e.ip}</div>}</td>
                  </tr>
                ))}
                {eventos.data.eventos.length === 0 && <tr><td colSpan={5} className="text-muted p-3">No hay registros con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {eventos.data?.hayMas && <p className="small text-muted mt-2">Se muestran los 500 más recientes; acote el rango de fechas o use los filtros.</p>}
    </>
  );
}
