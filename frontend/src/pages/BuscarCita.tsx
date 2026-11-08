import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { buscarNombreSchema, dniSchema, ETIQUETA_ESTADO_CITA, LARGO_NUMERICO } from '@clinica/shared';
import { citasApi, pacientesApi, type PacienteEncontrado } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { CampoDigitos } from '../components/Interaccion';
import { CitasAgenda } from '../components/CitasAgenda';
import { DniPaciente } from '../components/DniPaciente';
import { ModalEditarDatos } from '../components/ModalEditarDatos';
import { fechaPE } from '../formato';

const edadDe = (f: string) => Math.floor((Date.now() - new Date(`${f}T00:00:00-05:00`).getTime()) / (365.25 * 86_400_000));

/**
 * Buscar cita (recepcionista): para el paciente que ya tiene una cita y no sabe la fecha — verla, reprogramarla,
 * cancelarla, pagar su adelanto o corregir sus datos. Muestra solo agenda y contacto (RN-07).
 */
export default function BuscarCita() {
  const [modo, setModo] = useState<'dni' | 'nombre'>('dni');
  const [dni, setDni] = useState('');
  const [nombre, setNombre] = useState({ apellidos: '', nombres: '' });
  const [encontrados, setEncontrados] = useState<PacienteEncontrado[] | null>(null);
  const [pacienteId, setPacienteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState(false);
  const citas = useQuery({ queryKey: ['citas-paciente', pacienteId], queryFn: () => citasApi.dePaciente(pacienteId!), enabled: !!pacienteId });

  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.datos.mensaje : 'No se pudo conectar con el servidor');
  function limpiar() {
    setError(null);
    setEncontrados(null);
    setPacienteId(null);
  }
  async function buscarDni(e: FormEvent) {
    e.preventDefault();
    limpiar();
    const v = dniSchema.safeParse(dni);
    if (!v.success) return setError(v.error.issues[0].message);
    try {
      setPacienteId((await pacientesApi.porDni(dni)).id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setError('No hay ningún paciente con ese DNI. Si es nuevo, regístrelo en «Nueva cita».');
      else fallo(err);
    }
  }
  async function buscarNombre(e: FormEvent) {
    e.preventDefault();
    limpiar();
    const v = buscarNombreSchema.safeParse(nombre);
    if (!v.success) return setError(v.error.issues[0].message);
    try {
      const lista = await pacientesApi.porNombre({ apellidos: nombre.apellidos, nombres: nombre.nombres || undefined });
      if (lista.length === 1) setPacienteId(lista[0].id);
      else setEncontrados(lista);
    } catch (err) {
      fallo(err);
    }
  }

  const pestana = (m: 'dni' | 'nombre', texto: string) => (
    <li className="nav-item">
      <button type="button" className={`nav-link ${modo === m ? 'active' : ''}`} aria-pressed={modo === m} onClick={() => { setModo(m); limpiar(); }}>
        {texto}
      </button>
    </li>
  );
  const d = citas.data;

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Buscar cita</h1>
        {pacienteId && <button type="button" className="btn btn-link btn-sm" onClick={limpiar}>← Otra búsqueda</button>}
      </div>

      {!pacienteId && (
        <div className="tarjeta mb-3">
          <ul className="nav nav-tabs mb-3">
            {pestana('dni', 'Por DNI')}
            {pestana('nombre', 'Por nombre')}
          </ul>
          {modo === 'dni' ? (
            <form onSubmit={buscarDni}>
              <label htmlFor="b-dni" className="form-label">DNI del paciente</label>
              <div className="d-flex gap-2 align-items-start">
                <div style={{ maxWidth: 220 }} className="flex-grow-1"><CampoDigitos id="b-dni" value={dni} onChange={setDni} largo={LARGO_NUMERICO.dni} /></div>
                <button className="btn btn-acento">Buscar</button>
              </div>
            </form>
          ) : (
            <form onSubmit={buscarNombre}>
              <div className="row g-2 align-items-end">
                <div className="col-sm-4">
                  <label htmlFor="bc-apellidos" className="form-label">Apellidos</label>
                  <input id="bc-apellidos" className="form-control" value={nombre.apellidos} onChange={(e) => setNombre({ ...nombre, apellidos: e.target.value })} />
                </div>
                <div className="col-sm-4">
                  <label htmlFor="bc-nombres" className="form-label">Nombres <small className="text-muted">(opcional)</small></label>
                  <input id="bc-nombres" className="form-control" value={nombre.nombres} onChange={(e) => setNombre({ ...nombre, nombres: e.target.value })} />
                </div>
                <div className="col-sm-auto"><button className="btn btn-acento">Buscar</button></div>
              </div>
            </form>
          )}
          <p className="small text-muted mt-2 mb-0">Para el paciente que ya tiene una cita: verla, cambiarla, cancelarla o pagar su adelanto.</p>
          {error && <div className="text-danger small mt-2" role="alert">{error}</div>}
        </div>
      )}

      {!pacienteId && encontrados && (
        <div className="tarjeta mb-3">
          {encontrados.length === 0 ? (
            <p className="text-muted mb-0">No se encontró ningún paciente con «{[nombre.apellidos, nombre.nombres].filter(Boolean).join(' ')}».</p>
          ) : (
            <>
              <h2 className="h6 text-uppercase text-muted mb-2">{encontrados.length} paciente(s) — confirme con la edad y el celular</h2>
              <div className="list-group">
                {encontrados.map((x) => (
                  <button type="button" key={x.id} className="list-group-item list-group-item-action d-flex flex-wrap justify-content-between align-items-center gap-2" onClick={() => setPacienteId(x.id)}>
                    <span>
                      <strong>{x.nombres} {x.apellidos}</strong> · {x.edad} años · Cel. {x.celular} · <DniPaciente dni={x.dni} />
                      <br />
                      <span className="small text-muted">
                        {x.proximas === 0 ? 'Sin citas próximas' : `${x.proximas} cita${x.proximas > 1 ? 's' : ''} próxima${x.proximas > 1 ? 's' : ''} · la siguiente: ${fechaPE(x.siguienteCita!.slice(0, 10))} ${x.siguienteCita!.slice(11)}`}
                      </span>
                    </span>
                    <span className={`btn btn-sm ${x.proximas > 0 ? 'btn-acento' : 'btn-outline-secondary'}`}>Ver citas</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {pacienteId && citas.isLoading && <p className="text-muted">Cargando…</p>}
      {pacienteId && d && (
        <>
          <div className="tarjeta mb-3 py-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span>
              <strong>{d.paciente.nombres} {d.paciente.apellidos}</strong> · <DniPaciente dni={d.paciente.dni} /> · {edadDe(d.paciente.fechaNacimiento)} años · Cel. {d.paciente.telefono}
              {d.paciente.inasistencias > 0 && (
                <span className={`ms-2 badge ${d.paciente.restringido ? 'text-bg-danger' : 'text-bg-warning'}`}>
                  {d.paciente.inasistencias} inasistencia{d.paciente.inasistencias > 1 ? 's' : ''}
                </span>
              )}
              {Number(d.paciente.saldoFavor) > 0 && <span className="ms-2 badge text-bg-success">Saldo a favor S/ {d.paciente.saldoFavor}</span>}
            </span>
            <span className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setEditar(true)}>Editar datos</button>
              <Link className="btn btn-sm btn-acento" to={`/citas/nueva?paciente=${d.paciente.id}`}>+ Sacar otra cita</Link>
            </span>
          </div>

          <h2 className="h6 text-uppercase text-muted mb-2">Próximas citas ({d.proximas.length})</h2>
          <div className="mb-4">
            <CitasAgenda citas={d.proximas} conFecha mostrarPaciente={false} vacio={<div className="tarjeta text-muted">No tiene citas próximas.</div>} />
          </div>

          <h2 className="h6 text-uppercase text-muted mb-2">Citas anteriores ({d.anteriores.length})</h2>
          {d.anteriores.length === 0 ? (
            <div className="tarjeta text-muted">No tiene citas anteriores.</div>
          ) : (
            <div className="tarjeta p-0 table-responsive">
              <table className="table table-sm mb-0 align-middle">
                <thead><tr><th className="ps-3">Fecha</th><th>Odontólogo</th><th>Motivo</th><th className="text-end pe-3">Estado</th></tr></thead>
                <tbody>
                  {d.anteriores.map((c) => (
                    <tr key={c.id}>
                      <td className="ps-3 text-nowrap">{fechaPE(c.fecha)} {c.hora}</td>
                      <td>{c.odontologo}</td>
                      <td>{c.motivo}</td>
                      <td className="text-end pe-3"><span className={`chip chip-${c.estado}`}>{ETIQUETA_ESTADO_CITA[c.estado]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small text-muted mt-2">Solo datos de agenda: los diagnósticos y tratamientos realizados los ve el odontólogo en el historial (RN-07).</p>
          <ModalEditarDatos pacienteId={editar ? d.paciente.id : null} onCerrar={() => setEditar(false)} />
        </>
      )}
    </>
  );
}
