import { useMemo, useState, type FormEvent } from 'react';
import { dniSchema, LARGO_NUMERICO } from '@clinica/shared';
import { pacientesApi, type Paciente } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { FormReserva } from '../components/FormReserva';
import { FormPaciente } from '../components/FormPaciente';
import { CampoDigitos } from '../components/Interaccion';
import { FormContacto } from '../components/FormContacto';

/** CU-06 canal presencial (i_cita): la recepcionista busca por DNI y registra la cita. */
export default function NuevaCita() {
  const [dni, setDni] = useState('');
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
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

  return (
    <>
      <h1 className="h4 mb-3">Nueva cita presencial</h1>
      <form className="tarjeta mb-3" onSubmit={buscar}>
        <label htmlFor="dni" className="form-label">DNI del paciente</label>
        <div className="d-flex gap-2 align-items-start">
          <div style={{ maxWidth: 220 }} className="flex-grow-1">
            <CampoDigitos id="dni" value={dni} onChange={setDni} largo={LARGO_NUMERICO.dni} />
          </div>
          <button className="btn btn-acento">Buscar</button>
        </div>
        {error && <div className="text-danger small mt-2">{error}</div>}
      </form>

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
            <strong>{paciente.nombres} {paciente.apellidos}</strong> · DNI {paciente.dni} · Cel. {paciente.telefono}
            {paciente.inasistencias > 0 && (
              <span className={`ms-2 badge ${paciente.restringido ? 'text-bg-danger' : 'text-bg-warning'}`}>
                {paciente.inasistencias} inasistencia{paciente.inasistencias > 1 ? 's' : ''}
                {paciente.restringido && ' — requiere adelanto'}
              </span>
            )}
            {!editando && (
              <button className="btn btn-sm btn-link" onClick={() => setEditando(true)}>Editar contacto</button>
            )}
            {editando && (
              <div className="mt-3">
                <FormContacto
                  paciente={paciente}
                  onCancelar={() => setEditando(false)}
                  onGuardar={async (d) => setPaciente(await pacientesApi.actualizarContacto(paciente.id, d))}
                />
              </div>
            )}
          </div>
          <FormReserva key={paciente.id} pacienteId={paciente.id} />
        </>
      )}
    </>
  );
}
