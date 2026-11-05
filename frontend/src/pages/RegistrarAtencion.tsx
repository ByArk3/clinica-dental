import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { atencionSchema } from '@clinica/shared';
import { atencionApi, historialApi, tarifarioApi, type ResultadoAtencion } from '../api/recursos';
import { PiezaDental } from '../components/PiezaDental';
import { TablaInsumos, calcularConsumo } from '../components/TablaInsumos';
import { VistaHistorial } from '../components/VistaHistorial';
import { BotonAccion } from '../components/Interaccion';
import { hoyLima, mensajeError, solesPE } from '../formato';

interface Linea {
  clave: number;
  tratamientoId: number | '';
  piezaDental?: string;
}

let siguienteClave = 1;
const nuevaLinea = (): Linea => ({ clave: siguienteClave++, tratamientoId: '' });

/** CU-11 (i_atencion): diagnóstico, pieza dental, tratamientos del tarifario y observaciones. */
export default function RegistrarAtencion() {
  const { citaId } = useParams();
  const [params] = useSearchParams();
  const fecha = params.get('fecha') ?? hoyLima();
  const qc = useQueryClient();

  const citas = useQuery({ queryKey: ['mis-citas-od', fecha], queryFn: () => atencionApi.misCitas(fecha) });
  const cita = citas.data?.find((c) => c.id === Number(citaId));
  const historial = useQuery({ queryKey: ['historial', cita?.paciente.id], queryFn: () => historialApi.ver(cita!.paciente.id), enabled: !!cita });
  const tarifario = useQuery({ queryKey: ['tarifario-activo'], queryFn: () => tarifarioApi.listar({ activo: '1' }) });

  const [diagnostico, setDiagnostico] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([nuevaLinea()]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<ResultadoAtencion | null>(null);

  const porId = useMemo(() => new Map(tarifario.data?.map((t) => [t.id, t])), [tarifario.data]);
  const elegidos = lineas.map((l) => (l.tratamientoId ? porId.get(l.tratamientoId) : undefined));
  const consumo = calcularConsumo(elegidos);
  const total = elegidos.reduce((s, t) => s + Number(t?.precio ?? 0), 0);

  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof atencionApi.registrar>[1]) => atencionApi.registrar(Number(citaId), d),
    onSuccess: (r) => {
      setResultado(r);
      qc.invalidateQueries({ queryKey: ['mis-citas-od'] });
      qc.invalidateQueries({ queryKey: ['historial'] });
      qc.invalidateQueries({ queryKey: ['tarifario-activo'] });
    },
  });

  const actualizar = (clave: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  function enviar(e: FormEvent) {
    e.preventDefault();
    const datos = {
      diagnostico,
      observaciones: observaciones || undefined,
      tratamientos: lineas.filter((l) => l.tratamientoId).map((l) => ({ tratamientoId: Number(l.tratamientoId), piezaDental: l.piezaDental })),
    };
    const v = atencionSchema.safeParse(datos);
    if (!v.success) {
      // 6.1: resaltar los campos obligatorios y no guardar
      const c: Record<string, string> = {};
      for (const i of v.error.issues) c[i.path.join('.')] ??= i.message;
      return setErrores(c);
    }
    setErrores({});
    guardar.mutate(v.data);
  }

  if (citas.isLoading) return <p className="text-muted">Cargando…</p>;
  if (!cita) return <div className="alert alert-warning">La cita no está disponible para atención. <Link to="/atencion">Volver</Link></div>;

  if (resultado) {
    return (
      <div className="tarjeta">
        <h1 className="h5">Atención registrada</h1>
        <p>
          {cita.paciente.nombres} {cita.paciente.apellidos} — total del tarifario <strong>{solesPE(resultado.total)}</strong>. La cita pasó a «Atendida» y queda lista para cobrar en caja.
        </p>
        <h2 className="h6">Insumos descontados</h2>
        <ul className="small">
          {resultado.insumos.map((i) => (
            <li key={i.insumo}>
              {i.insumo}: {Math.abs(Number(i.cantidad))} {i.unidad} (quedan {Number(i.saldo)})
              {i.faltante && <span className="text-danger"> — faltaron {Number(i.faltante)}</span>}
            </li>
          ))}
        </ul>
        {resultado.alertas.length > 0 && (
          <div className="alert alert-warning">Stock mínimo alcanzado: {resultado.alertas.join(', ')}. Se generó una alerta para el administrador.</div>
        )}
        <Link to="/atencion" className="btn btn-acento">Volver a mis citas</Link>
      </div>
    );
  }

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-3">
        <h1 className="h4 mb-0">Registrar atención</h1>
        <Link to="/atencion" className="small">← Mis citas del día</Link>
      </div>
      <p className="mb-3">
        <strong>{cita.paciente.nombres} {cita.paciente.apellidos}</strong> · {cita.hora} · {cita.motivo}
      </p>
      {cita.paciente.alergias && (
        <div className="alert alert-danger py-2" role="note">⚠ Alergias: <strong>{cita.paciente.alergias}</strong></div>
      )}

      <div className="row g-3">
        <div className="col-lg-7">
          <form className="tarjeta" onSubmit={enviar} noValidate>
            <div className="mb-3">
              <label htmlFor="diagnostico" className="form-label">Diagnóstico *</label>
              <textarea id="diagnostico" rows={2} className={`form-control ${errores.diagnostico ? 'is-invalid' : ''}`} value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} />
              <div className="invalid-feedback">{errores.diagnostico}</div>
            </div>

            <span className="form-label d-block">Tratamientos del tarifario *</span>
            {errores.tratamientos && <div className="text-danger small mb-2">{errores.tratamientos}</div>}
            {lineas.map((l, n) => (
              <div className="border rounded p-2 mb-2" key={l.clave}>
                <div className="d-flex gap-2 mb-2">
                  <select
                    aria-label={`Tratamiento ${n + 1}`}
                    className={`form-select ${errores.tratamientos && !l.tratamientoId ? 'is-invalid' : ''}`}
                    value={l.tratamientoId}
                    onChange={(e) => actualizar(l.clave, { tratamientoId: e.target.value ? Number(e.target.value) : '' })}
                  >
                    <option value="">Seleccione…</option>
                    {tarifario.data?.map((t) => (
                      <option key={t.id} value={t.id}>{t.nombre} — {solesPE(t.precio)}</option>
                    ))}
                  </select>
                  {lineas.length > 1 && (
                    <button type="button" className="btn btn-outline-secondary" aria-label={`Quitar tratamiento ${n + 1}`} onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>
                      ✕
                    </button>
                  )}
                </div>
                <PiezaDental valor={l.piezaDental} onCambiar={(p) => actualizar(l.clave, { piezaDental: p })} />
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>
              + Agregar otro tratamiento
            </button>

            <div className="mb-3">
              <label htmlFor="observaciones" className="form-label">Observaciones</label>
              <textarea id="observaciones" rows={2} className="form-control" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </div>

            <h2 className="h6">Insumos que se descontarán</h2>
            <TablaInsumos filas={consumo} />

            <div className="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
              <span>Total del tarifario: <strong>{solesPE(total)}</strong></span>
            </div>
            {guardar.isError && <div className="alert alert-danger mt-3" role="alert">{mensajeError(guardar.error)}</div>}
            <BotonAccion type="submit" className="btn btn-acento w-100 mt-3" mutacion={guardar}>Guardar atención</BotonAccion>
          </form>
        </div>
        <div className="col-lg-5">
          {historial.data && <VistaHistorial h={historial.data} compacto />}
        </div>
      </div>
    </>
  );
}
