import { useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usuarioModificarSchema, usuarioNuevoSchema, type Rol, type UsuarioModificarDTO, type UsuarioNuevoDTO } from '@clinica/shared';
import { usuariosApi, type Usuario } from '../api/recursos';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { CampoPassword } from '../components/CampoPassword';
import { useAuth } from '../auth';
import { camposApi, erroresZod, mensajeError } from '../formato';

const horaPE = (iso: string) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const ROL_PE: Record<Rol, string> = { paciente: 'Paciente', recepcionista: 'Recepcionista', odontologo: 'Odontólogo', administrador: 'Administrador' };

/** CU-34 Registrar · CU-35 Listar · CU-36 Modificar · CU-37 Desactivar usuarios. */
export default function Usuarios() {
  const qc = useQueryClient();
  const { usuario: yo } = useAuth();
  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  const [estado, setEstado] = useState('1');
  const [editando, setEditando] = useState<Usuario | 'nuevo' | null>(null);
  const [cambiar, setCambiar] = useState<Usuario | null>(null);
  const lista = useQuery({ queryKey: ['usuarios', q, rol, estado], queryFn: () => usuariosApi.listar({ q, rol, activo: estado }) });
  const desbloquear = useMutation({
    mutationFn: (u: Usuario) => usuariosApi.desbloquear(u.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  });
  const estadoMut = useMutation({
    mutationFn: (u: Usuario) => usuariosApi.cambiarEstado(u.id, !u.activo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setCambiar(null); },
  });

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Usuarios</h1>
        <button className="btn btn-acento" onClick={() => setEditando('nuevo')}>+ Registrar usuario</button>
      </div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Nombre o correo" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="form-select" style={{ maxWidth: 180 }} aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)}>
          <option value="">Todos los roles</option>
          {(Object.keys(ROL_PE) as Rol[]).map((r) => <option key={r} value={r}>{ROL_PE[r]}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 160 }} aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="1">Activos</option><option value="0">Desactivados</option><option value="">Todos</option>
        </select>
      </div>
      <div className="tarjeta p-0">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th></th></tr></thead>
            <tbody>
              {lista.data?.map((u) => (
                <tr key={u.id} className={u.activo ? '' : 'text-muted'}>
                  <td>{u.nombres} {u.id === yo?.id && <span className="badge text-bg-light">Usted</span>} {!u.activo && <span className="badge text-bg-secondary">Desactivado</span>}
                    {u.bloqueadoHasta && <span className="badge text-bg-danger">Bloqueado hasta las {horaPE(u.bloqueadoHasta)}</span>}
                    {u.cmp && <div className="small text-muted">CMP {u.cmp}{u.especialidad ? ` · ${u.especialidad}` : ''}</div>}
                  </td>
                  <td className="small">{u.email}</td>
                  <td>{ROL_PE[u.rol]}</td>
                  <td className="text-end text-nowrap">
                    {u.bloqueadoHasta && (
                      <button className="btn btn-sm btn-outline-primary me-1" disabled={desbloquear.isPending} onClick={() => desbloquear.mutate(u)}>Desbloquear</button>
                    )}
                    {u.rol !== 'paciente' && <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEditando(u)}>Modificar</button>}
                    {u.id !== yo?.id && (
                      <button className={`btn btn-sm ${u.activo ? 'btn-outline-danger' : 'btn-outline-success'}`} onClick={() => setCambiar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editando && <FormUsuario usuario={editando === 'nuevo' ? null : editando} esYo={editando !== 'nuevo' && editando.id === yo?.id} onCerrar={() => setEditando(null)} />}
      <ModalConfirmar
        abierto={!!cambiar}
        titulo={cambiar?.activo ? 'Desactivar usuario' : 'Activar usuario'}
        textoConfirmar={cambiar?.activo ? 'Desactivar' : 'Activar'}
        peligro={cambiar?.activo}
        procesando={estadoMut.isPending}
        error={estadoMut.isError ? mensajeError(estadoMut.error) : null}
        onConfirmar={() => cambiar && estadoMut.mutate(cambiar)}
        onCerrar={() => { setCambiar(null); estadoMut.reset(); }}
      >
        <p className="mb-0">{cambiar?.activo ? `«${cambiar.nombres}» ya no podrá iniciar sesión y se cerrarán sus sesiones abiertas. Su historial se conserva.` : `¿Activar a «${cambiar?.nombres}»?`}</p>
      </ModalConfirmar>
    </>
  );
}

function FormUsuario({ usuario, esYo, onCerrar }: { usuario: Usuario | null; esYo: boolean; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    nombres: usuario?.nombres ?? '',
    email: usuario?.email ?? '',
    rol: (usuario?.rol ?? 'recepcionista') as 'recepcionista' | 'odontologo' | 'administrador',
    password: '',
    cmp: usuario?.cmp ?? '',
    especialidad: usuario?.especialidad ?? '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const guardar = useMutation({
    mutationFn: (d: UsuarioNuevoDTO | UsuarioModificarDTO) =>
      usuario ? usuariosApi.modificar(usuario.id, d) : usuariosApi.crear(d as UsuarioNuevoDTO),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); onCerrar(); },
    onError: (e) => setErrores(camposApi(e)),
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = (usuario ? usuarioModificarSchema : usuarioNuevoSchema).safeParse(v);
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }
  const campo = (k: keyof typeof v, etiqueta: string, col: string, tipo = 'text') => (
    <div className={col}>
      <label htmlFor={`u-${k}`} className="form-label">{etiqueta}</label>
      {tipo === 'password' ? (
        <CampoPassword id={`u-${k}`} value={v[k]} onChange={(x) => setV({ ...v, [k]: x })} autoComplete="new-password" error={errores[k]} />
      ) : (
        <>
          <input id={`u-${k}`} type={tipo} className={`form-control ${errores[k] ? 'is-invalid' : ''}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          <div className="invalid-feedback">{errores[k]}</div>
        </>
      )}
    </div>
  );
  // El rol de odontólogo no se asigna ni se quita a una cuenta existente; el admin no se quita su rol
  const rolFijo = esYo || usuario?.rol === 'odontologo';
  return (
    <Modal show onHide={onCerrar} centered>
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">{usuario ? 'Modificar usuario' : 'Registrar usuario'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="row g-3">
            {campo('nombres', 'Nombres y apellidos', 'col-12')}
            {campo('email', 'Correo', 'col-sm-7', 'email')}
            <div className="col-sm-5">
              <label htmlFor="u-rol" className="form-label">Rol</label>
              <select id="u-rol" className={`form-select ${errores.rol ? 'is-invalid' : ''}`} value={v.rol} disabled={rolFijo} onChange={(e) => setV({ ...v, rol: e.target.value as typeof v.rol })}>
                <option value="recepcionista">Recepcionista</option>
                {(!usuario || usuario.rol === 'odontologo') && <option value="odontologo">Odontólogo</option>}
                <option value="administrador">Administrador</option>
              </select>
              <div className="invalid-feedback">{errores.rol}</div>
            </div>
            {v.rol === 'odontologo' && (
              <>
                {campo('cmp', 'CMP (opcional)', 'col-sm-5')}
                {campo('especialidad', 'Especialidad (opcional)', 'col-sm-7')}
              </>
            )}
            {campo('password', usuario ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña', 'col-12', 'password')}
          </div>
          <p className="small text-muted mt-2 mb-0">Mínimo 8 caracteres, con letras y números.{usuario && ' Si cambia la contraseña, el correo o el rol, se cerrarán las sesiones abiertas del usuario.'}</p>
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
