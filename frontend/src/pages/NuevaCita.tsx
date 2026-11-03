import { useState, type FormEvent } from 'react';
import { dniSchema } from '@clinica/shared';
import { pacientesApi, type Paciente } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { FormReserva } from '../components/FormReserva';
import { FormPaciente } from '../components/FormPaciente';

/** CU-06 canal presencial (i_cita): la recepcionista busca por DNI y registra la cita. */
export default function NuevaCita() {
  const [dni, setDni] = useState('');
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPaciente(null);
    setNoEncontrado(false);
    const v = dniSchema.safeParse(dni);
    if (!v.success) return setError(v.error.issues[0].message);
    try {
      setPaciente(await pacientesApi.porDni(dni));
    } catch (err) {
      // 4.1: DNI no registrado → formulario de paciente nuevo (CU-03)
      if (err instanceof ApiError && err.status === 404) setNoEncontrado(true);
      else setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    }
  }

  return (
    <>
      <h1 className="h4 mb-3">Nueva cita presencial</h1>
      <form className="tarjeta mb-3" onSubmit={buscar}>
        <label htmlFor="dni" className="form-label">DNI del paciente</label>
        <div className="d-flex gap-2">
          <input id="dni" className="form-control" style={{ maxWidth: 220 }} inputMode="numeric" maxLength={8} value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-acento">Buscar</button>
        </div>
        {error && <div className="text-danger small mt-2">{error}</div>}
      </form>

      {noEncontrado && (
        <div className="tarjeta mb-3">
          <div className="alert alert-info">Paciente no encontrado. Regístrelo para continuar con la cita.</div>
          <FormPaciente
            dniInicial={dni}
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
          </div>
          <FormReserva key={paciente.id} pacienteId={paciente.id} />
        </>
      )}
    </>
  );
}
