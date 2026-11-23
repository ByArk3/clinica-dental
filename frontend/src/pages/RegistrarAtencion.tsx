import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { atencionSchema, limpiarTextoLibre, LIMITE_TEXTO, nombrePieza, type AtencionDTO } from '@clinica/shared';
import { atencionApi, historialApi, tarifarioApi, type ResultadoAtencion } from '../api/recursos';
import { PiezaDental } from '../components/PiezaDental';
import { InsumosAtencion, consumoEfectivo, type AjusteInsumos } from '../components/InsumosAtencion';
import { FranjaPaciente, SeccionAtencion, UltimasAtenciones } from '../components/PanelAtencion';
import { BotonAccion, ConfirmarSiNo, Contador, FilaResumen } from '../components/Interaccion';
import { edadDe, hoyLima, mensajeError, numPE, solesPE } from '../formato';

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
  const [porConfirmar, setPorConfirmar] = useState<AtencionDTO | null>(null);
  const [ajuste, setAjuste] = useState<AjusteInsumos>(null);
  const [motivoInsumos, setMotivoInsumos] = useState('');
  const catalogo = useQuery({ queryKey: ['insumos-para-atencion'], queryFn: atencionApi.insumos, staleTime: 60_000 });

  const porId = useMemo(() => new Map(tarifario.data?.map((t) => [t.id, t])), [tarifario.data]);
  const elegidos = lineas.map((l) => (l.tratamientoId ? porId.get(l.tratamientoId) : undefined));
  const consumo = consumoEfectivo(elegidos, ajuste);
  const nombreInsumo = (id: number) => catalogo.data?.find((c) => c.id === id) ?? elegidos.flatMap((t) => t?.insumos ?? []).map((i) => ({ id: i.insumoId, nombre: i.nombre, unidad: i.unidad })).find((x) => x.id === id);
  const total = elegidos.reduce((s, t) => s + Number(t?.precio ?? 0), 0);

  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof atencionApi.registrar>[1]) => atencionApi.registrar(Number(citaId), d),
    onSuccess: (r) => {
      setPorConfirmar(null);
      setResultado(r);
      qc.invalidateQueries({ queryKey: ['mis-citas-od'] });
      qc.invalidateQueries({ queryKey: ['historial'] });
      qc.invalidateQueries({ queryKey: ['tarifario-activo'] });
      qc.invalidateQueries({ queryKey: ['insumos-para-atencion'] });
    },
    onError: () => setPorConfirmar(null),
  });

  const actualizar = (clave: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  function enviar(e: FormEvent) {
    e.preventDefault();
    const datos = {
      diagnostico,
      observaciones: observaciones || undefined,
      tratamientos: lineas.filter((l) => l.tratamientoId).map((l) => ({ tratamientoId: Number(l.tratamientoId), piezaDental: l.piezaDental })),
      // pendiente 32: solo si el odontólogo ajustó los insumos
      ...(ajuste ? { insumos: consumo, motivoInsumos: motivoInsumos || undefined } : {}),
    };
    const v = atencionSchema.safeParse(datos);
    if (!v.success) {
      // 6.1: resaltar los campos obligatorios y no guardar
      const c: Record<string, string> = {};
      for (const i of v.error.issues) c[i.path.join('.')] ??= i.message;
      return setErrores(c);
    }
    setErrores({});
    setPorConfirmar(v.data); // primero «¿Guardar la atención?» (Sí / No)
  }

  if (citas.isLoading) return <p className="text-muted">Cargando…</p>;
  if (!cita) return <div className="alert alert-warning">La cita no está disponible para atención. <Link to="/atencion/registrar">Volver</Link></div>;

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
        <Link to="/atencion/registrar" className="btn btn-acento">Atender al siguiente paciente</Link>
      </div>
    );
  }

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h1 className="h4 mb-0">Registrar atención</h1>
        <Link to="/atencion/registrar" className="btn btn-outline-secondary btn-sm btn-regresar"><span aria-hidden="true">←</span> Regresar</Link>
      </div>
      <FranjaPaciente nombre={`${cita.paciente.nombres} ${cita.paciente.apellidos}`} dni={cita.paciente.dni} edad={edadDe(cita.paciente.fechaNacimiento)} hora={cita.hora} motivo={cita.motivo} h={historial.data} />

      <div className="row g-3">
        <div className="col-lg-8">
          <form onSubmit={enviar} noValidate>
            <SeccionAtencion n={1} titulo="Diagnóstico" obligatorio>
              <label htmlFor="diagnostico" className="visually-hidden">Diagnóstico</label>
              <textarea id="diagnostico" rows={2} className={`form-control ${errores.diagnostico ? 'is-invalid' : ''}`} value={diagnostico} maxLength={LIMITE_TEXTO.diagnostico} onChange={(e) => setDiagnostico(limpiarTextoLibre(e.target.value, LIMITE_TEXTO.diagnostico))} />
              <div className="invalid-feedback">{errores.diagnostico}</div>
              <Contador valor={diagnostico} max={LIMITE_TEXTO.diagnostico} />
            </SeccionAtencion>

            <SeccionAtencion n={2} titulo="Tratamientos" obligatorio>
              {errores.tratamientos && <div className="text-danger small mb-2">{errores.tratamientos}</div>}
              {lineas.map((l, n) => (
                <div className="linea-tratamiento" key={l.clave}>
                  <div className="d-flex gap-2 align-items-center mb-2">
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
                      <button type="button" className="btn btn-outline-secondary" aria-label={`Quitar tratamiento ${n + 1}`} title="Quitar tratamiento" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>
                        ✕
                      </button>
                    )}
                  </div>
                  <PiezaDental plegable valor={l.piezaDental} edad={edadDe(cita.paciente.fechaNacimiento)} onCambiar={(p) => actualizar(l.clave, { piezaDental: p })} />
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}>
                + Agregar otro tratamiento
              </button>
            </SeccionAtencion>

            <SeccionAtencion n={3} titulo="Observaciones" opcional>
              <label htmlFor="observaciones" className="visually-hidden">Observaciones</label>
              <textarea id="observaciones" rows={2} placeholder="Indicaciones para el paciente, próximos pasos…" className={`form-control ${errores.observaciones ? 'is-invalid' : ''}`} value={observaciones} maxLength={LIMITE_TEXTO.observaciones} onChange={(e) => setObservaciones(limpiarTextoLibre(e.target.value, LIMITE_TEXTO.observaciones))} />
              <div className="invalid-feedback">{errores.observaciones}</div>
              <Contador valor={observaciones} max={LIMITE_TEXTO.observaciones} />
            </SeccionAtencion>

            <SeccionAtencion n={4} titulo="Resumen y guardar">
              <InsumosAtencion tratamientos={elegidos} catalogo={catalogo.data ?? []} ajuste={ajuste} onAjuste={setAjuste} motivo={motivoInsumos} onMotivo={setMotivoInsumos} error={errores.insumos ?? errores.motivoInsumos} />
              <div className="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
                <span>Total del tarifario: <strong>{solesPE(total)}</strong></span>
              </div>
              {guardar.isError && <div className="alert alert-danger mt-3" role="alert">{mensajeError(guardar.error)}</div>}
              <BotonAccion type="submit" className="btn btn-acento w-100 mt-3" mutacion={guardar}>Guardar atención</BotonAccion>
            </SeccionAtencion>
            <ConfirmarSiNo abierto={!!porConfirmar} titulo="¿Guardar la atención?" ocupado={guardar.isPending} onNo={() => setPorConfirmar(null)} onSi={() => porConfirmar && guardar.mutate(porConfirmar)}>
              {porConfirmar && (
                <>
                  <FilaResumen etiqueta="Paciente">{cita.paciente.nombres} {cita.paciente.apellidos}</FilaResumen>
                  <FilaResumen etiqueta="Diagnóstico">{porConfirmar.diagnostico.length > 160 ? `${porConfirmar.diagnostico.slice(0, 160)}…` : porConfirmar.diagnostico}</FilaResumen>
                  {porConfirmar.tratamientos.map((t, i) => {
                    const tr = porId.get(t.tratamientoId);
                    return (
                      <FilaResumen key={i} etiqueta={i === 0 ? 'Tratamientos' : ''}>
                        {tr?.nombre}{t.piezaDental ? ` — pieza ${t.piezaDental} · ${nombrePieza(t.piezaDental)}` : ''} · {solesPE(tr?.precio ?? 0)}
                      </FilaResumen>
                    );
                  })}
                  <FilaResumen etiqueta="Total a Caja">{solesPE(total)}</FilaResumen>
                  <FilaResumen etiqueta={ajuste ? 'Insumos (ajustados)' : 'Insumos'}>
                    {consumo.length === 0 ? 'Ninguno' : consumo.map((f) => { const i = nombreInsumo(f.insumoId); return `${i?.nombre ?? ''}: ${numPE(f.cantidad)} ${i?.unidad ?? ''}`; }).join(' · ')}
                  </FilaResumen>
                  <p className="small text-muted mt-2 mb-0">Al guardar se descuentan los insumos del stock y la cita pasa a Caja para cobrarse.</p>
                </>
              )}
            </ConfirmarSiNo>
          </form>
        </div>
        <div className="col-lg-4">
          {historial.data && <UltimasAtenciones h={historial.data} />}
        </div>
      </div>
    </>
  );
}
