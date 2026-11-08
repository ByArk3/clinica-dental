import { useCallback, useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usuarioModificarSchema, usuarioNuevoSchema, type Rol, type UsuarioModificarDTO, type UsuarioNuevoDTO, LARGO_NUMERICO, soloDigitos } from '@clinica/shared';
import { usuariosApi, type Usuario } from '../api/recursos';
import { ModalConfirmar } from '../components/ModalConfirmar';
import { CampoPassword } from '../components/CampoPassword';
import { useAuth } from '../auth';
import { AvisoFlotante, BotonAccion } from '../components/Interaccion';
import { camposApi, erroresZod, mensajeError } from '../formato';

const horaPE = (iso: string) => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const ROL_PE: Record<Rol, string> = { paciente: 'Paciente', recepcionista: 'Recepcionista', odontologo: 'Odontólogo', administrador: 'Administrador' };

/**
 * CU-34 Registrar · CU-35 Listar · CU-36 Modificar · CU-37 Desactivar usuarios · CU-59 Traspasar principal.
 * RN-23: el administrador principal está protegido y es el único que gestiona a otros administradores.
 */
export default function Usuarios() {
  const qc = useQueryClient();
  const { usuario: yo } = useAuth();
  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  const [estado, setEstado] = useState('1');
  const [editando, setEditando] = useState<Usuario | 'nuevo' | null>(null);
  const [cambiar, setCambiar] = useState<Usuario | null>(null);
  const [traspaso, setTraspaso] = useState<Usuario | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const quitarHecho = useCallback(() => setHecho(null), []);
  const lista = useQuery({ queryKey: ['usuarios', q, rol, estado], queryFn: () => usuariosApi.listar({ q, rol, activo: estado }) });
  const desbloquear = useMutation({
    mutationFn: (u: Usuario) => usuariosApi.desbloquear(u.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  });
  const estadoMut = useMutation({
    mutationFn: (u: Usuario) => usuariosApi.cambiarEstado(u.id, !u.activo),
    onSuccess: (u) => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setCambiar(null); setHecho(`${u.nombres} ${u.activo ? 'activado' : 'desactivado'}`); },
  });
  // RN-23: ¿el usuario en sesión es el principal? ¿quién es el principal?
  const principal = lista.data?.find((u) => u.principal);
  const soyPrincipal = !!yo && principal?.id === yo.id;
  /** Puede modificar a este usuario: a sí mismo, o a quien no sea el principal; a otros admins solo el principal. */
  const puedeModificar = (u: Usuario) => u.rol !== 'paciente' && (u.id === yo?.id || (!u.principal && (u.rol !== 'administrador' || soyPrincipal)));
  const puedeCambiarEstado = (u: Usuario) => u.id !== yo?.id && !u.principal && (u.rol !== 'administrador' || soyPrincipal);

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Usuarios</h1>
        <button className="btn btn-acento" onClick={() => setEditando('nuevo')}>+ Registrar usuario</button>
      </div>
      {principal && !soyPrincipal && (
        <div className="aviso-principal mb-3" role="note">
          <span className="insignia-principal">★ Principal</span>
          <span><strong>{principal.nombres}</strong> es el administrador principal: solo él crea, modifica o desactiva a otros administradores.</span>
        </div>
      )}
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
                  <td>{u.nombres} {u.principal && <span className="insignia-principal" title="Administrador principal (RN-23)">★ Principal</span>} {u.id === yo?.id && <span className="badge text-bg-light">Usted</span>} {!u.activo && <span className="badge text-bg-secondary">Desactivado</span>}
                    {u.bloqueadoHasta && <span className="badge text-bg-danger">Bloqueado hasta las {horaPE(u.bloqueadoHasta)}</span>}
                    {u.cmp && <div className="small text-muted">CMP {u.cmp}{u.especialidad ? ` · ${u.especialidad}` : ''}</div>}
                  </td>
                  <td className="small">{u.email}</td>
                  <td>{ROL_PE[u.rol]}</td>
                  <td className="text-end text-nowrap">
                    {u.bloqueadoHasta && (
                      <button className="btn btn-sm btn-outline-primary me-1" disabled={desbloquear.isPending} onClick={() => desbloquear.mutate(u)}>Desbloquear</button>
                    )}
                    {soyPrincipal && u.rol === 'administrador' && u.activo && u.id !== yo?.id && (
                      <button className="btn btn-sm btn-outline-warning me-1" onClick={() => setTraspaso(u)} title="Traspasar el papel de administrador principal">★ Hacer principal</button>
                    )}
                    {puedeModificar(u) && <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEditando(u)}>Modificar</button>}
                    {puedeCambiarEstado(u) && (
                      <button className={`btn btn-sm ${u.activo ? 'btn-outline-danger' : 'btn-outline-success'}`} onClick={() => setCambiar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                    )}
                    {u.rol === 'administrador' && u.id !== yo?.id && !puedeModificar(u) && (
                      <span className="small text-muted" title={u.principal ? 'Nadie puede modificar ni desactivar al administrador principal' : 'Solo el administrador principal gestiona a otros administradores'}>
                        🔒 {u.principal ? 'Protegido' : 'Solo el principal'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editando && (
        <FormUsuario
          usuario={editando === 'nuevo' ? null : editando}
          esYo={editando !== 'nuevo' && editando.id === yo?.id}
          soyPrincipal={soyPrincipal}
          onCerrar={() => setEditando(null)}
          onHecho={setHecho}
        />
      )}
      {traspaso && <ModalTraspaso destino={traspaso} onCerrar={() => setTraspaso(null)} onHecho={setHecho} />}
      {hecho && <AvisoFlotante icono="✓" duracion={4500} onCerrar={quitarHecho}>{hecho}</AvisoFlotante>}
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

function FormUsuario({ usuario, esYo, soyPrincipal, onCerrar, onHecho }: { usuario: Usuario | null; esYo: boolean; soyPrincipal: boolean; onCerrar: () => void; onHecho: (m: string) => void }) {
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
    onSuccess: (u) => { qc.invalidateQueries({ queryKey: ['usuarios'] }); onHecho(usuario ? `Usuario «${u.nombres}» actualizado` : `Usuario «${u.nombres}» creado como ${ROL_PE[u.rol].toLowerCase()}`); onCerrar(); },
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
          <input
            id={`u-${k}`}
            type={tipo}
            inputMode={k === 'cmp' ? 'numeric' : undefined}
            maxLength={k === 'cmp' ? LARGO_NUMERICO.cmp : undefined}
            className={`form-control ${errores[k] ? 'is-invalid' : ''}`}
            value={v[k]}
            onChange={(e) => setV({ ...v, [k]: k === 'cmp' ? soloDigitos(e.target.value, LARGO_NUMERICO.cmp) : e.target.value })}
          />
          <div className="invalid-feedback">{errores[k]}</div>
        </>
      )}
    </div>
  );
  // El rol de odontólogo no se asigna ni se quita a una cuenta existente; el admin no se quita su rol
  const rolFijo = esYo || usuario?.rol === 'odontologo';
  const otroAdmin = !!usuario && !esYo && usuario.rol === 'administrador';
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
                {(soyPrincipal || usuario?.rol === 'administrador') && <option value="administrador">Administrador</option>}
              </select>
              <div className="invalid-feedback">{errores.rol}</div>
            </div>
            {v.rol === 'odontologo' && (
              <>
                {campo('cmp', 'CMP (opcional)', 'col-sm-5')}
                {campo('especialidad', 'Especialidad (opcional)', 'col-sm-7')}
              </>
            )}
            {otroAdmin ? (
              <div className="col-12">
                <div className="small text-muted border rounded p-2" style={{ background: 'var(--bs-tertiary-bg)' }}>
                  🔒 La contraseña de otro administrador no se cambia aquí: él mismo usa «¿Olvidó su contraseña?».
                </div>
              </div>
            ) : (
              campo('password', usuario ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña', 'col-12', 'password')
            )}
          </div>
          <p className="small text-muted mt-2 mb-0">{!otroAdmin && 'Mínimo 8 caracteres, con letras y números. '}{usuario && 'Si cambia la contraseña, el correo o el rol, se cerrarán las sesiones abiertas del usuario.'}</p>
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

/** CU-59 Traspasar el papel de administrador principal: se confirma con la contraseña del principal. */
function ModalTraspaso({ destino, onCerrar, onHecho }: { destino: Usuario; onCerrar: () => void; onHecho: (m: string) => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const traspasar = useMutation({
    mutationFn: () => usuariosApi.traspasarPrincipal(destino.id, password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usuarios'] });
      onHecho(`${destino.nombres} es ahora el administrador principal`);
      onCerrar();
    },
    onError: (e) => setError(camposApi(e).password ?? mensajeError(e)),
  });
  return (
    <Modal show onHide={onCerrar} centered>
      <form onSubmit={(e) => { e.preventDefault(); if (!password) return setError('Ingrese su contraseña'); traspasar.mutate(); }} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">Traspasar administrador principal</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="traspaso mb-3">
            <span className="insignia-principal">★ Principal</span>
            <span className="mx-2 text-muted" aria-hidden="true">→</span>
            <strong>{destino.nombres}</strong>
            <div className="small text-muted">{destino.email}</div>
          </div>
          <ul className="small mb-3 ps-3">
            <li><strong>{destino.nombres}</strong> pasará a ser el único que gestiona a otros administradores.</li>
            <li>Usted seguirá siendo administrador, pero ya no estará protegido: el nuevo principal podrá modificarlo o desactivarlo.</li>
            <li>Queda registrado en la auditoría.</li>
          </ul>
          <label htmlFor="t-password" className="form-label">Confirme con su contraseña</label>
          <CampoPassword id="t-password" value={password} onChange={(x) => { setPassword(x); setError(null); }} autoComplete="current-password" error={error ?? undefined} />
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>Cancelar</button>
          <BotonAccion mutacion={traspasar} className="btn btn-warning">Traspasar</BotonAccion>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
