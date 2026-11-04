import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { historialApi, type PacienteEncontrado } from '../api/recursos';
import { VistaHistorial } from '../components/VistaHistorial';
import { fechaPE, mensajeError } from '../formato';

/** CU-10 (i_historial): buscar paciente por DNI o nombre y ver su historial clínico. */
export default function Historial() {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<PacienteEncontrado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const [elegido, setElegido] = useState<number | null>(Number(params.get('paciente')) || null);
  const historial = useQuery({ queryKey: ['historial', elegido], queryFn: () => historialApi.ver(elegido!), enabled: !!elegido });

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setElegido(null);
    setResultados(null);
    if (q.trim().length < 2) return setError('Ingrese al menos 2 caracteres');
    try {
      const r = await historialApi.buscar(q);
      setResultados(r);
      if (r.length === 1) setElegido(r[0].id);
    } catch (err) {
      setError(mensajeError(err)); // 2.1 «Paciente no encontrado» / 4.1 sin permiso
    }
  }

  return (
    <>
      <h1 className="h4 mb-3">Historial clínico</h1>
      <form className="tarjeta mb-3" onSubmit={buscar}>
        <label htmlFor="q" className="form-label">DNI o nombre del paciente</label>
        <div className="d-flex gap-2">
          <input id="q" className="form-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: 72458190 o Quispe" />
          <button className="btn btn-acento">Buscar</button>
        </div>
        {error && <div className="alert alert-warning mt-3 mb-0" role="alert">{error}</div>}
      </form>

      {resultados && resultados.length > 1 && (
        <div className="list-group mb-3">
          {resultados.map((p) => (
            <button key={p.id} type="button" className={`list-group-item list-group-item-action ${elegido === p.id ? 'active' : ''}`} onClick={() => setElegido(p.id)}>
              <strong>{p.apellidos}, {p.nombres}</strong>
              <span className="small ms-2">DNI {p.dni} · nac. {fechaPE(p.fechaNacimiento)} · {p.atenciones} atención(es)</span>
            </button>
          ))}
        </div>
      )}

      {historial.isLoading && <p className="text-muted">Cargando historial…</p>}
      {historial.isError && <div className="alert alert-danger">{mensajeError(historial.error)}</div>}
      {historial.data && <VistaHistorial h={historial.data} />}
    </>
  );
}
