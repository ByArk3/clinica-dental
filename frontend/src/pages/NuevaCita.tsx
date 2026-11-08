import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buscarNombreSchema, dniSchema, LARGO_NUMERICO, type PacienteSinDniDTO } from '@clinica/shared';
import { pacientesApi, type Paciente, type PacienteEncontrado } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { FormReserva } from '../components/FormReserva';
import { FormPaciente } from '../components/FormPaciente';
import { CampoDigitos } from '../components/Interaccion';
import { DniPaciente } from '../components/DniPaciente';
import { ModalEditarDatos } from '../components/ModalEditarDatos';
import { fechaPE } from '../formato';

/**
 * CU-06 canal presencial (i_cita): la recepcionista busca al paciente por DNI o por nombre y registra la cita.
 * Si es nuevo y no tiene su DNI a la mano, lo registra sin DNI («DNI pendiente») y lo completa después.
 */
export default function NuevaCita() {
  const [dni, setDni] = useState('');
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [modo, setModo] = useState<'dni' | 'nombre'>('dni');
  const [nombre, setNombre] = useState({ apellidos: '', nombres: '' });
  const [encontrados, setEncontrados] = useState<PacienteEncontrado[] | null>(null);
  const [sinDni, setSinDni] = useState(false);
  // Registro sin DNI: si hay pacientes parecidos (mismo nombre o nacimiento), se pregunta antes de crear otro
  const [parecidos, setParecidos] = useState<{ datos: PacienteSinDniDTO; lista: PacienteEncontrado[] } | null>(null);
  // Desde «Buscar cita → Sacar otra cita»: el paciente llega ya elegido
  const [params] = useSearchParams();
  const pacienteInicial = Number(params.get('paciente')) || null;
  useEffect(() => {
    if (pacienteInicial) pacientesApi.ver(pacienteInicial).then(setPaciente).catch(() => setError('No se encontró el paciente'));
  }, [pacienteInicial]);
  // Autocompletar con RENIEC (si la clínica configuró un proveedor): null = no se consultó o no hubo datos
  const [reniec, setReniec] = useState<{ estado: 'buscando' | 'ok' | 'sin_datos' | 'no_disponible'; nombres?: string; apellidos?: string } | null>(null);

  const datosReniec = useMemo(
    () => (reniec?.estado === 'ok' ? { nombres: reniec.nombres!, apellidos: reniec.apellidos! } : undefined),
    [reniec],
  );

  async function consultarReniec(d: string) {
    setReniec({ estado: 'buscando' });
    try {
      const r = await pacientesApi.reniec(d);
      if (r.encontrado) setReniec({ estado: 'ok', nombres: r.nombres, apellidos: r.apellidos });
      else setReniec(r.motivo === 'no_configurado' ? null : { estado: r.motivo === 'no_encontrado' ? 'sin_datos' : 'no_disponible' });
    } catch {
      setReniec(null); // si falla, se escriben los datos a mano
    }
  }

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPaciente(null);
    setNoEncontrado(false);
    setEditando(false);
    setReniec(null);
    setSinDni(false);
    setEncontrados(null);
    const v = dniSchema.safeParse(dni);
    if (!v.success) return setError(v.error.issues[0].message);
    try {
      setPaciente(await pacientesApi.porDni(dni));
    } catch (err) {
      // 4.1: DNI no registrado → formulario de paciente nuevo (CU-03)
      if (err instanceof ApiError && err.status === 404) {
        setNoEncontrado(true);
        void consultarReniec(dni);
      }
      else setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    }
  }

  function limpiar() {
    setError(null);
    setPaciente(null);
    setNoEncontrado(false);
    setEditando(false);
    setReniec(null);
    setEncontrados(null);
    setSinDni(false);
    setParecidos(null);
  }

  async function buscarNombre(e: FormEvent) {
    e.preventDefault();
    limpiar();
    const v = buscarNombreSchema.safeParse(nombre);
    if (!v.success) return setError(v.error.issues[0].message);
    try {
      setEncontrados(await pacientesApi.porNombre({ apellidos: nombre.apellidos, nombres: nombre.nombres || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    }
  }

  async function elegir(id: number) {
    limpiar();
    try {
      setPaciente(await pacientesApi.ver(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    }
  }

  function abrirSinDni() {
    limpiar();
    setSinDni(true);
  }

  /** Antes de crear un paciente sin DNI, busca parecidos (apellidos + nombres + fecha de nacimiento) para no duplicarlo. */
  async function registrarSinDni(datos: PacienteSinDniDTO, confirmado = false) {
    if (!confirmado) {
      const lista = await pacientesApi.porNombre({ apellidos: datos.apellidos, nombres: datos.nombres, fechaNacimiento: datos.fechaNacimiento });
      if (lista.length > 0) {
        setParecidos({ datos, lista: lista.slice(0, 5) });
        return;
      }
    }
    setPaciente(await pacientesApi.registrarSinDni(datos));
    setSinDni(false);
    setParecidos(null);
  }

  const pestana = (m: 'dni' | 'nombre', texto: string) => (
    <li className="nav-item">
      <button type="button" className={`nav-link ${modo === m ? 'active' : ''}`} aria-pressed={modo === m} onClick={() => { setModo(m); limpiar(); }}>
        {texto}
      </button>
    </li>
  );
  // El registro (con DNI o sin DNI) está en la pestaña «Registrar por DNI»
  const botonesNuevo = (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <span className="small text-muted">¿No es ninguno?</span>
      <button type="button" className="btn btn-sm btn-acento" onClick={() => { limpiar(); setModo('dni'); }}>Registrar paciente nuevo →</button>
    </div>
  );

  return (
    <>
      <h1 className="h4 mb-3">Nueva cita presencial</h1>
      <div className="tarjeta mb-3">
        <ul className="nav nav-tabs mb-3">
          {pestana('dni', 'Registrar por DNI')}
          {pestana('nombre', 'Registrar por nombre')}
        </ul>
        {modo === 'dni' ? (
          <form onSubmit={buscar}>
            <label htmlFor="dni" className="form-label">DNI del paciente</label>
            <div className="d-flex gap-2 align-items-start">
              <div style={{ maxWidth: 220 }} className="flex-grow-1">
                <CampoDigitos id="dni" value={dni} onChange={setDni} largo={LARGO_NUMERICO.dni} />
              </div>
              <button className="btn btn-acento">Buscar</button>
            </div>
            <p className="small text-muted mt-2 mb-2">Si ya es paciente, aparece con sus datos; si es nuevo, se registra aquí. ¿No recuerda su DNI? Use «Registrar por nombre».</p>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={abrirSinDni}>
              🪪 El paciente no tiene DNI a la mano → Registrar sin DNI
            </button>
          </form>
        ) : (
          <form onSubmit={buscarNombre}>
            <div className="row g-2 align-items-end">
              <div className="col-sm-4">
                <label htmlFor="b-apellidos" className="form-label">Apellidos</label>
                <input id="b-apellidos" className="form-control" value={nombre.apellidos} onChange={(e) => setNombre({ ...nombre, apellidos: e.target.value })} />
              </div>
              <div className="col-sm-4">
                <label htmlFor="b-nombres" className="form-label">Nombres <small className="text-muted">(opcional)</small></label>
                <input id="b-nombres" className="form-control" value={nombre.nombres} onChange={(e) => setNombre({ ...nombre, nombres: e.target.value })} />
              </div>
              <div className="col-sm-auto"><button className="btn btn-acento">Buscar</button></div>
            </div>
            <p className="small text-muted mt-2 mb-0">No importa si escribe con o sin tildes, ni pequeños errores de tipeo.</p>
          </form>
        )}
        {error && <div className="text-danger small mt-2">{error}</div>}
      </div>

      {encontrados && (
        <div className="tarjeta mb-3">
          {encontrados.length === 0 ? (
            <div className="alert alert-info">No se encontró ningún paciente con «{[nombre.apellidos, nombre.nombres].filter(Boolean).join(' ')}».</div>
          ) : (
            <>
              <h2 className="h6 text-uppercase text-muted mb-2">{encontrados.length} paciente(s) — confirme con la edad y el celular</h2>
              <div className="list-group mb-3">
                {encontrados.map((x) => (
                  <button type="button" key={x.id} className="list-group-item list-group-item-action d-flex flex-wrap justify-content-between align-items-center gap-2" onClick={() => elegir(x.id)}>
                    <span>
                      <strong>{x.nombres} {x.apellidos}</strong> · {x.edad} años · Cel. {x.celular} · <DniPaciente dni={x.dni} />
                    </span>
                    <span className="btn btn-sm btn-acento">Elegir</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {botonesNuevo}
        </div>
      )}

      {sinDni && (
        <div className="tarjeta mb-3">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
            <div>
              <h2 className="h5 mb-1">Registrar paciente sin DNI</h2>
              <p className="small text-muted mb-0">Quedará con <DniPaciente dni={null} />. Se le puede sacar cita, atender y cobrar; el DNI se completa después.</p>
            </div>
            <button type="button" className="btn btn-link btn-sm" onClick={() => { limpiar(); setModo('dni'); }}>Volver a «Registrar por DNI»</button>
          </div>
          {parecidos ? (
            <div className="alert alert-warning mb-0">
              <strong>¿Es alguno de estos pacientes?</strong> Ya hay pacientes con un nombre parecido:
              <div className="list-group mt-2">
                {parecidos.lista.map((x) => (
                  <div key={x.id} className="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <span><strong>{x.nombres} {x.apellidos}</strong> · {x.edad} años ({fechaPE(x.fechaNacimiento)}) · Cel. {x.celular} · <DniPaciente dni={x.dni} /></span>
                    <button type="button" className="btn btn-sm btn-acento" onClick={() => elegir(x.id)}>Es este paciente</button>
                  </div>
                ))}
              </div>
              <div className="d-flex flex-wrap gap-2 mt-3">
                <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => registrarSinDni(parecidos.datos, true).catch((e) => setError(e instanceof ApiError ? e.datos.mensaje : 'No se pudo registrar'))}>
                  No es ninguno: registrar sin DNI
                </button>
                <button type="button" className="btn btn-sm btn-link" onClick={() => setParecidos(null)}>Volver al formulario</button>
              </div>
            </div>
          ) : (
            <FormPaciente sinDni textoBoton="Registrar sin DNI" onCancelar={() => setSinDni(false)} onEnviar={(d) => registrarSinDni(d)} />
          )}
          <p className="small text-muted mt-2 mb-0">Si es menor de edad, anote los datos del apoderado (nombre, DNI y celular).</p>
        </div>
      )}

      {noEncontrado && (
        <div className="tarjeta mb-3">
          <div className="alert alert-info">Paciente no encontrado. Regístrelo para continuar con la cita.</div>
          {reniec?.estado === 'buscando' && <p className="small text-muted" role="status">Buscando nombres en RENIEC…</p>}
          {reniec?.estado === 'ok' && <p className="small text-success" role="status">Los nombres se completaron con una consulta a RENIEC; verifíquelos con el DNI y corríjalos si hace falta.</p>}
          {reniec?.estado === 'sin_datos' && <p className="small text-muted" role="status">RENIEC no devolvió datos para ese DNI; escríbalos a mano.</p>}
          {reniec?.estado === 'no_disponible' && <p className="small text-muted" role="status">No se pudo consultar RENIEC ahora; escriba los datos a mano.</p>}
          <FormPaciente
            dniInicial={dni}
            inicial={datosReniec}
            textoBoton="Registrar paciente"
            onCancelar={() => setNoEncontrado(false)}
            onEnviar={async (datos) => {
              setPaciente(await pacientesApi.registrar(datos));
              setNoEncontrado(false);
            }}
          />
        </div>
      )}

      {paciente && (
        <>
          <div className="tarjeta mb-3 py-3">
            <strong>{paciente.nombres} {paciente.apellidos}</strong> · <DniPaciente dni={paciente.dni} /> · Cel. {paciente.telefono}
            {paciente.inasistencias > 0 && (
              <span className={`ms-2 badge ${paciente.restringido ? 'text-bg-danger' : 'text-bg-warning'}`}>
                {paciente.inasistencias} inasistencia{paciente.inasistencias > 1 ? 's' : ''}
                {paciente.restringido && ' — requiere adelanto'}
              </span>
            )}
            <button className="btn btn-sm btn-link" onClick={() => setEditando(true)}>{paciente.dni ? 'Editar datos' : 'Editar datos / completar DNI'}</button>
          </div>
          <ModalEditarDatos
            pacienteId={editando ? paciente.id : null}
            onCerrar={() => {
              setEditando(false);
              pacientesApi.ver(paciente.id).then(setPaciente).catch(() => {});
            }}
          />
          <FormReserva key={paciente.id} pacienteId={paciente.id} />
        </>
      )}
    </>
  );
}
