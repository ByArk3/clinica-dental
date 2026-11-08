import { useEffect, useMemo, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ETIQUETA_SEXO, LARGO_NUMERICO, SEXOS, dniSchema, editarPacienteSchema, esMenorDeEdad, soloLetras, type Sexo } from '@clinica/shared';
import { citasApi, pacientesApi, type Cita, type Paciente } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { useUsuarioOpcional } from '../auth';
import { fechaPE, mensajeError, solesPE } from '../formato';
import { BotonAccion, CampoDigitos } from './Interaccion';
import { DniPaciente } from './DniPaciente';
import { fechaMinimaNacimiento, hoyEnLima } from '@clinica/shared';

type Campo = 'telefono' | 'email' | 'direccion' | 'apoderado' | 'nombres' | 'apellidos' | 'fechaNacimiento' | 'sexo';
type Valores = Record<Campo, string>;
const IDENTIDAD: Campo[] = ['nombres', 'apellidos', 'fechaNacimiento', 'sexo'];
const ETIQUETAS: Record<Campo, string> = {
  telefono: 'Celular', email: 'Correo', direccion: 'Dirección', apoderado: 'Apoderado',
  nombres: 'Nombres', apellidos: 'Apellidos', fechaNacimiento: 'Fecha de nacimiento', sexo: 'Sexo',
};

const valoresDe = (p: Paciente): Valores => ({
  telefono: p.telefono, email: p.email ?? '', direccion: p.direccion ?? '', apoderado: p.apoderado ?? '',
  nombres: p.nombres, apellidos: p.apellidos, fechaNacimiento: p.fechaNacimiento, sexo: p.sexo ?? '',
});
const mostrar = (k: Campo, v: string) => (!v ? '(vacío)' : k === 'fechaNacimiento' ? fechaPE(v) : k === 'sexo' ? ETIQUETA_SEXO[v as Sexo] : v);
const edadDe = (f: string) => (f ? Math.floor((Date.now() - new Date(`${f}T00:00:00-05:00`).getTime()) / (365.25 * 86_400_000)) : null);

interface Props {
  pacienteId: number | null;
  /** Si se abre desde una cita, muestra también la pestaña «Datos de la cita» */
  cita?: Cita | null;
  onCerrar: () => void;
}

/**
 * CU-58 Corregir datos del paciente (y de la cita). Los campos vienen llenos con los datos actuales:
 * se cambia solo lo que está mal. Lo cambiado se marca con su valor anterior y se puede deshacer.
 * Identidad → pide motivo y queda en la auditoría. DNI: se completa si está pendiente; cambiarlo, solo el Administrador.
 */
export function ModalEditarDatos({ pacienteId, cita, onCerrar }: Props) {
  const qc = useQueryClient();
  const usuario = useUsuarioOpcional();
  const esAdmin = usuario?.rol === 'administrador';
  const [pestana, setPestana] = useState<'paciente' | 'cita'>('paciente');
  const paciente = useQuery({ queryKey: ['paciente', pacienteId], queryFn: () => pacientesApi.ver(pacienteId!), enabled: !!pacienteId });
  const [v, setV] = useState<Valores | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  const original = useMemo(() => (paciente.data ? valoresDe(paciente.data) : null), [paciente.data]);
  useEffect(() => {
    if (original) setV(original);
  }, [original]);

  const cambiados = v && original ? (Object.keys(v) as Campo[]).filter((k) => v[k].trim() !== original[k]) : [];
  const cambiaIdentidad = cambiados.some((k) => IDENTIDAD.includes(k));

  function cerrar() {
    setV(null);
    setMotivo('');
    setErrores({});
    setAviso(null);
    setPestana('paciente');
    guardar.reset();
    onCerrar();
  }

  const guardar = useMutation({
    mutationFn: () => {
      const r = editarPacienteSchema.safeParse({ ...v, sexo: v!.sexo || null, motivo: motivo || undefined });
      if (!r.success) {
        const c: Record<string, string> = {};
        for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
        setErrores(c);
        throw new Error('Revise los campos marcados');
      }
      return pacientesApi.editar(pacienteId!, r.data);
    },
    onSuccess: (r) => {
      setErrores({});
      setMotivo('');
      setAviso(`Se guardó: ${r.cambios.join(', ')}.`);
      qc.setQueryData(['paciente', pacienteId], r.paciente);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'paciente' });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrores(e.datos.campos ?? {});
    },
  });

  // Obligatorios: identidad y celular; el correo si tiene cuenta web; el apoderado si es menor de 18
  const obligatorio = (k: Campo) =>
    ['nombres', 'apellidos', 'fechaNacimiento', 'sexo', 'telefono'].includes(k) ||
    (k === 'email' && !!paciente.data?.tieneCuenta) ||
    (k === 'apoderado' && !!v && esMenorDeEdad(v.fechaNacimiento));
  const campo = (k: Campo, opciones: { col: string; tipo?: string }) => {
    if (!v || !original) return null;
    const cambio = v[k].trim() !== original[k];
    return (
      <div className={opciones.col} key={k}>
        <label htmlFor={`e-${k}`} className={`form-label ${obligatorio(k) ? 'obligatorio' : ''}`}>
          {ETIQUETAS[k]} {!obligatorio(k) && <small className="text-muted">(opcional)</small>}
        </label>
        {k === 'telefono' ? (
          <CampoDigitos id="e-telefono" value={v.telefono} onChange={(x) => setV({ ...v, telefono: x })} largo={LARGO_NUMERICO.celular} error={errores.telefono} className={cambio ? 'campo-cambiado' : ''} />
        ) : k === 'sexo' ? (
          <select id="e-sexo" className={`form-select ${errores.sexo ? 'is-invalid' : ''} ${cambio ? 'campo-cambiado' : ''}`} value={v.sexo} onChange={(e) => setV({ ...v, sexo: e.target.value })}>
            <option value="">—</option>
            {SEXOS.map((s) => <option key={s} value={s}>{ETIQUETA_SEXO[s]}</option>)}
          </select>
        ) : (
          <input
            id={`e-${k}`}
            type={opciones.tipo ?? 'text'}
            {...(k === 'fechaNacimiento' ? { min: fechaMinimaNacimiento(), max: hoyEnLima() } : {})}
            className={`form-control ${errores[k] ? 'is-invalid' : ''} ${cambio ? 'campo-cambiado' : ''}`}
            value={v[k]}
            onChange={(e) => setV({ ...v, [k]: k === 'nombres' || k === 'apellidos' ? soloLetras(e.target.value) : e.target.value })}
          />
        )}
        {k !== 'telefono' && <div className="invalid-feedback">{errores[k]}</div>}
        {k === 'apoderado' && obligatorio(k) && !errores.apoderado && <div className="form-text">Es menor de edad: nombre, DNI y celular del padre, madre o tutor.</div>}
        {k === 'email' && obligatorio(k) && !errores.email && <div className="form-text">Inicia sesión en la web con este correo.</div>}
        {k === 'fechaNacimiento' && !cambio && edadDe(v.fechaNacimiento) !== null && <div className="form-text">{edadDe(v.fechaNacimiento)} años</div>}
        {cambio && (
          <div className="form-text text-warning-emphasis">
            Antes: «{mostrar(k, original[k])}»{' '}
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setV({ ...v, [k]: original[k] })}>
              Deshacer
            </button>
          </div>
        )}
      </div>
    );
  };

  const p = paciente.data;
  return (
    <Modal show={!!pacienteId} onHide={cerrar} size="lg" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="h5">Editar datos{p ? ` · ${p.nombres} ${p.apellidos}` : ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {cita && (
          <ul className="nav nav-tabs mb-3">
            <li className="nav-item"><button type="button" className={`nav-link ${pestana === 'paciente' ? 'active' : ''}`} onClick={() => { setPestana('paciente'); setAviso(null); }}>Datos del paciente</button></li>
            <li className="nav-item"><button type="button" className={`nav-link ${pestana === 'cita' ? 'active' : ''}`} onClick={() => { setPestana('cita'); setAviso(null); }}>Datos de la cita</button></li>
          </ul>
        )}
        {paciente.isLoading && <p className="text-muted">Cargando…</p>}
        {paciente.isError && <div className="alert alert-danger">{mensajeError(paciente.error)}</div>}
        {pestana === 'paciente' && p && v && (
          <>
            <h3 className="h6 text-uppercase text-muted small mb-2">Contacto <span className="fw-normal text-lowercase">— se cambia libremente</span></h3>
            <div className="row g-3 mb-4">
              {campo('telefono', { col: 'col-sm-4' })}
              {campo('email', { col: 'col-sm-4', tipo: 'email' })}
              {campo('apoderado', { col: 'col-sm-4' })}
              {campo('direccion', { col: 'col-12' })}
            </div>
            <h3 className="h6 text-uppercase text-muted small mb-2">Identidad <span className="fw-normal text-lowercase">— si cambia, pide el motivo y queda en la auditoría</span></h3>
            <div className="row g-3">
              {campo('nombres', { col: 'col-sm-6' })}
              {campo('apellidos', { col: 'col-sm-6' })}
              {campo('fechaNacimiento', { col: 'col-sm-6', tipo: 'date' })}
              {campo('sexo', { col: 'col-sm-6' })}
              {cambiaIdentidad && (
                <div className="col-12">
                  <label htmlFor="e-motivo" className="form-label">Motivo de la corrección <span className="text-danger">*</span></label>
                  <input id="e-motivo" className={`form-control ${errores.motivo ? 'is-invalid' : ''}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: se escribió mal el apellido al registrarlo" />
                  <div className="invalid-feedback">{errores.motivo}</div>
                  <div className="form-text">Obligatorio porque cambió un dato de identidad.</div>
                </div>
              )}
            </div>
            <SeccionDni paciente={p} esAdmin={esAdmin} />
            <p className="small text-muted mt-3 mb-0">Alergias y antecedentes los corrige el odontólogo (datos clínicos, RN-07).</p>
          </>
        )}
        {pestana === 'cita' && cita && <SeccionCita cita={cita} onGuardado={() => setAviso('Se guardaron los datos de la cita.')} />}
        {aviso && <div className="alert alert-success mt-3 mb-0" role="status">✓ {aviso}</div>}
        {guardar.isError && !(guardar.error instanceof ApiError && guardar.error.datos.campos) && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-secondary" onClick={cerrar}>Cerrar</button>
        {pestana === 'paciente' && (
          <BotonAccion type="button" mutacion={guardar} disabled={cambiados.length === 0} onClick={() => { setAviso(null); guardar.mutate(); }} title={cambiados.length === 0 ? 'No hay cambios' : undefined}>
            Guardar cambios{cambiados.length > 0 ? ` (${cambiados.length})` : ''}
          </BotonAccion>
        )}
      </Modal.Footer>
    </Modal>
  );
}

/** DNI: completar si está pendiente (recepcionista) o cambiar (solo Administrador, con motivo). Avisa si RENIEC no coincide. */
function SeccionDni({ paciente, esAdmin }: { paciente: Paciente; esAdmin: boolean }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [dni, setDni] = useState('');
  const [motivo, setMotivo] = useState('');
  const [reniec, setReniec] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const puedeEditar = !paciente.dni || esAdmin;
  const guardar = useMutation({
    mutationFn: (confirmar: boolean) => pacientesApi.guardarDni(paciente.id, { dni, motivo: motivo || undefined, confirmar }),
    onSuccess: (p) => {
      qc.setQueryData(['paciente', paciente.id], p);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'paciente' });
      setAbierto(false);
      setDni('');
      setMotivo('');
      setReniec(null);
      setError(null);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.datos.codigo === 'DNI_RENIEC_NO_COINCIDE') setReniec(e.datos.campos?.reniec ?? '');
      else setError(mensajeError(e));
    },
  });
  function enviar(confirmar = false) {
    setError(null);
    const r = dniSchema.safeParse(dni);
    if (!r.success) return setError(r.error.issues[0].message);
    guardar.mutate(confirmar);
  }
  return (
    <div className="border rounded p-3 mt-4" style={{ background: 'var(--bs-tertiary-bg)' }} data-testid="seccion-dni">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>
          {paciente.dni ? '🔒 ' : ''}<strong><DniPaciente dni={paciente.dni} /></strong>
          <br />
          <span className="small text-muted">
            {!paciente.dni ? 'Complételo cuando el paciente traiga su DNI.' : esAdmin ? 'Cambiarlo pide el motivo y queda en la auditoría.' : 'Solo el Administrador puede cambiarlo (con verificación de RENIEC).'}
          </span>
        </span>
        {puedeEditar && !abierto && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAbierto(true)}>
            {paciente.dni ? 'Cambiar DNI' : 'Completar DNI'}
          </button>
        )}
      </div>
      {abierto && (
        <div className="mt-3">
          <label htmlFor="e-dni" className="form-label">{paciente.dni ? 'Nuevo DNI' : 'DNI'}</label>
          <div className="d-flex flex-wrap gap-2 align-items-start">
            <div style={{ maxWidth: 220 }} className="flex-grow-1">
              <CampoDigitos id="e-dni" value={dni} onChange={(x) => { setDni(x); setReniec(null); }} largo={LARGO_NUMERICO.dni} />
            </div>
            <BotonAccion type="button" mutacion={guardar} onClick={() => enviar(false)}>Guardar DNI</BotonAccion>
            <button type="button" className="btn btn-link" onClick={() => { setAbierto(false); setReniec(null); setError(null); }}>Cancelar</button>
          </div>
          {paciente.dni && (
            <input className="form-control mt-2" placeholder="Motivo del cambio (obligatorio)" aria-label="Motivo del cambio de DNI" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          )}
          {reniec !== null && (
            <div className="alert alert-warning mt-2 mb-0">
              RENIEC indica <strong>{reniec}</strong> para ese DNI, y el paciente está registrado como <strong>{paciente.nombres} {paciente.apellidos}</strong>. Verifique el número con el paciente.
              <div className="mt-2"><button type="button" className="btn btn-sm btn-outline-dark" onClick={() => enviar(true)}>Es correcto: guardar de todos modos</button></div>
            </div>
          )}
          {error && <div className="text-danger small mt-2" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}

/** Datos de la cita: motivo y, si el adelanto no se pagó, el tratamiento previsto (el adelanto se recalcula). */
function SeccionCita({ cita, onGuardado }: { cita: Cita; onGuardado: () => void }) {
  const qc = useQueryClient();
  const tarifario = useQuery({ queryKey: ['tarifario-publico'], queryFn: citasApi.tarifario, staleTime: 5 * 60_000 });
  const [motivo, setMotivo] = useState(cita.motivo);
  const [tratamientoId, setTratamientoId] = useState<number | ''>(cita.tratamientoPrevistoId ?? '');
  const editable = ['pendiente_confirmacion', 'pendiente_adelanto', 'confirmada', 'pago_en_verificacion'].includes(cita.estado);
  const puedeCambiarTratamiento = cita.estado === 'pendiente_adelanto' && !cita.adelantoPagado;
  const cambioMotivo = motivo.trim() !== cita.motivo;
  const cambioTratamiento = tratamientoId !== '' && tratamientoId !== (cita.tratamientoPrevistoId ?? '');
  const guardar = useMutation({
    mutationFn: () => citasApi.editarDatos(cita.id, { motivo: motivo.trim(), ...(cambioTratamiento ? { tratamientoPrevistoId: Number(tratamientoId) } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries();
      onGuardado();
    },
  });
  const nombreOriginal = tarifario.data?.find((t) => t.id === cita.tratamientoPrevistoId)?.nombre ?? cita.tratamientoPrevisto;
  return (
    <>
      <p className="mb-3">
        <strong>{fechaPE(cita.fecha)} · {cita.hora}</strong> · {cita.odontologo}
        <br />
        <span className="small text-muted">Para cambiar fecha, hora u odontólogo use «Reprogramar».</span>
      </p>
      {!editable && <div className="alert alert-secondary">Esta cita ya no se puede editar.</div>}
      <div className="mb-3">
        <label htmlFor="e-motivo-cita" className="form-label">Motivo</label>
        <input id="e-motivo-cita" className={`form-control ${cambioMotivo ? 'campo-cambiado' : ''}`} value={motivo} disabled={!editable} onChange={(e) => setMotivo(e.target.value)} />
        {cambioMotivo && (
          <div className="form-text text-warning-emphasis">
            Antes: «{cita.motivo}» <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setMotivo(cita.motivo)}>Deshacer</button>
          </div>
        )}
      </div>
      <div className="mb-3">
        <label htmlFor="e-tratamiento" className="form-label">Tratamiento previsto</label>
        <select id="e-tratamiento" className={`form-select ${cambioTratamiento ? 'campo-cambiado' : ''}`} value={tratamientoId} disabled={!editable || !puedeCambiarTratamiento} onChange={(e) => setTratamientoId(e.target.value ? Number(e.target.value) : '')}>
          {tratamientoId === '' && <option value="">—</option>}
          {tarifario.data?.map((t) => <option key={t.id} value={t.id}>{t.nombre} — {solesPE(t.precio)}</option>)}
        </select>
        {!puedeCambiarTratamiento && editable && (
          <div className="form-text">
            🔒 No se puede cambiar:{' '}
            {cita.adelantoPagado ? `el adelanto de ${solesPE(cita.adelantoPagado)} ya se pagó` : cita.estado === 'pago_en_verificacion' ? 'el pago del adelanto está en verificación' : 'la cita ya no tiene adelanto pendiente'}. El cobro final se ajusta en caja según lo que se atienda.
          </div>
        )}
        {puedeCambiarTratamiento && !cambioTratamiento && cita.montoAdelanto && <div className="form-text">Adelanto actual: {solesPE(cita.montoAdelanto)}. Si cambia el tratamiento, el adelanto se recalcula.</div>}
        {cambioTratamiento && (
          <div className="form-text text-warning-emphasis">
            Antes: «{nombreOriginal}» · el adelanto se recalculará (50 % o 100 %).{' '}
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setTratamientoId(cita.tratamientoPrevistoId ?? '')}>Deshacer</button>
          </div>
        )}
      </div>
      {guardar.isError && <div className="alert alert-danger" role="alert">{mensajeError(guardar.error)}</div>}
      {editable && (
        <BotonAccion type="button" mutacion={guardar} disabled={!cambioMotivo && !cambioTratamiento} onClick={() => guardar.mutate()}>
          Guardar datos de la cita
        </BotonAccion>
      )}
    </>
  );
}
