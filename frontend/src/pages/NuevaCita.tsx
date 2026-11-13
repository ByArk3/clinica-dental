import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dniSchema, LARGO_NUMERICO, type PacienteSinDniDTO } from '@clinica/shared';
import { pacientesApi, type Paciente, type PacienteEncontrado } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { FormReserva } from '../components/FormReserva';
import { FormPaciente } from '../components/FormPaciente';
import { CampoDigitos } from '../components/Interaccion';
import { DniPaciente } from '../components/DniPaciente';
import { ModalEditarDatos } from '../components/ModalEditarDatos';
import { fechaPE } from '../formato';

/**
 * CU-06 canal presencial (i_cita): pestaña «Registrar por DNI» (paciente que ya existe o nuevo, con RENIEC) y
 * pestaña «Registrar sin DNI» (paciente nuevo sin DNI a la mano: queda «DNI pendiente»). Si no recuerda su DNI,
 * se lo busca por nombre en «Buscar cita» y desde ahí «Sacar otra cita» vuelve aquí con el paciente cargado.
 */
export default function NuevaCita() {
  const [dni, setDni] = useState('');
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [modo, setModo] = useState<'dni' | 'sindni'>('dni');
  // Registro sin DNI: si hay pacientes parecidos (mismo nombre o nacimiento), se pregunta antes de crear otro
  const [parecidos, setParecidos] = useState<{ datos: PacienteSinDniDTO; lista: PacienteEncontrado[] } | null>(null);
  // Desde «Buscar cita → Sacar otra cita»: el paciente llega ya elegido
  const [params] = useSearchParams();
  const pacienteInicial = Number(params.get('paciente')) || null;
  useEffect(() => {
    if (pacienteInicial) void elegir(pacienteInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setParecidos(null);
  }

  /** Carga un paciente ya registrado y abre la pestaña que le corresponde (con DNI o «DNI pendiente»). */
  async function elegir(id: number) {
    limpiar();
    try {
      const p = await pacientesApi.ver(id);
      setModo(p.dni ? 'dni' : 'sindni');
      setDni(p.dni ?? '');
      setPaciente(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    }
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
    setParecidos(null);
  }

  const pestana = (m: 'dni' | 'sindni', texto: string) => (
    <li className="nav-item">
      <button type="button" className={`nav-link ${modo === m ? 'active' : ''}`} aria-pressed={modo === m} onClick={() => { setModo(m); limpiar(); setDni(''); }}>
        {texto}
      </button>
    </li>
  );

  return (
    <>
      <h1 className="h4 mb-3">Nueva cita presencial</h1>
      <div className="tarjeta mb-3">
        <ul className="nav nav-tabs mb-3">
          {pestana('dni', 'Registrar por DNI')}
          {pestana('sindni', 'Registrar sin DNI')}
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
            <p className="small text-muted mt-2 mb-0">
              Si ya es paciente, aparece con sus datos; si es nuevo, se registra aquí. ¿No recuerda su DNI? Búsquelo por nombre en{' '}
              <Link to="/citas/buscar">Buscar cita</Link>.
            </p>
          </form>
        ) : (
          <p className="small text-muted mb-0">
            Para el paciente <strong>nuevo</strong> que no trae su DNI: quedará con <DniPaciente dni={null} /> y se le puede sacar cita, atender y cobrar; el DNI se completa después.
            Si ya se registró antes, búsquelo en <Link to="/citas/buscar">Buscar cita</Link>.
          </p>
        )}
        {error && <div className="text-danger small mt-2">{error}</div>}
      </div>

      {modo === 'sindni' && !paciente && (
        <div className="tarjeta mb-3">
          <h2 className="h5 mb-3">Registrar paciente sin DNI</h2>
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
            <FormPaciente sinDni confirmar textoBoton="Registrar sin DNI" onEnviar={(d) => registrarSinDni(d)} />
          )}
        </div>
      )}

      {modo === 'dni' && noEncontrado && (
        <div className="tarjeta mb-3">
          <div className="alert alert-info">Paciente no encontrado. Regístrelo para continuar con la cita.</div>
          {reniec?.estado === 'buscando' && <p className="small text-muted" role="status">Buscando nombres en RENIEC…</p>}
          {reniec?.estado === 'ok' && <p className="small text-success" role="status">Los nombres se completaron con una consulta a RENIEC; verifíquelos con el DNI y corríjalos si hace falta.</p>}
          {reniec?.estado === 'sin_datos' && <p className="small text-muted" role="status">RENIEC no devolvió datos para ese DNI; escríbalos a mano.</p>}
          {reniec?.estado === 'no_disponible' && <p className="small text-muted" role="status">No se pudo consultar RENIEC ahora; escriba los datos a mano.</p>}
          <FormPaciente
            confirmar
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
            <button className="btn btn-sm btn-link" onClick={() => setEditando(true)}>{paciente.dni ? 'Editar datos del paciente' : 'Editar datos del paciente / completar DNI'}</button>
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
