import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { editarAtencionSchema, MENSAJES } from '@clinica/shared';
import { atencionApi, tarifarioApi, type ResultadoEdicion } from '../api/recursos';
import { PiezaDental } from '../components/PiezaDental';
import { fechaPE, mensajeError, solesPE } from '../formato';

interface Linea {
  clave: number;
  tratamientoId: number | '';
  piezaDental?: string;
}
let siguienteClave = 1;

/** Corregir una atención ya registrada (solo su odontólogo). Queda la versión anterior en el historial. */
export default function EditarAtencion() {
  const { atencionId } = useParams();
  const id = Number(atencionId);
  const qc = useQueryClient();
  const atencion = useQuery({ queryKey: ['atencion', id], queryFn: () => atencionApi.ver(id), retry: false });
  const tarifario = useQuery({ queryKey: ['tarifario-activo'], queryFn: () => tarifarioApi.listar({ activo: '1' }) });

  const [diagnostico, setDiagnostico] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<ResultadoEdicion | null>(null);

  useEffect(() => {
    if (!atencion.data) return;
    setDiagnostico(atencion.data.diagnostico);
    setObservaciones(atencion.data.observaciones ?? '');
    setLineas(atencion.data.tratamientos.map((t) => ({ clave: siguienteClave++, tratamientoId: t.tratamientoId, piezaDental: t.piezaDental ?? undefined })));
  }, [atencion.data]);

  // Se ofrecen los activos del tarifario y los que ya tenía la atención (aunque luego se hayan desactivado)
  const opciones = useMemo(() => {
    const m = new Map((tarifario.data ?? []).map((t) => [t.id, { id: t.id, nombre: t.nombre, precio: t.precio }]));
    for (const t of atencion.data?.tratamientos ?? []) if (!m.has(t.tratamientoId)) m.set(t.tratamientoId, { id: t.tratamientoId, nombre: t.nombre, precio: t.precio });
    return [...m.values()];
  }, [tarifario.data, atencion.data]);
  const cobrada = !!atencion.data?.cobrada;

  const guardar = useMutation({
    mutationFn: (d: Parameters<typeof atencionApi.editar>[1]) => atencionApi.editar(id, d),
    onSuccess: (r) => {
      setResultado(r);
      for (const k of ['historial', 'mis-citas-od', 'atencion', 'tarifario-activo']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const actualizar = (clave: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  function enviar(e: FormEvent) {
    e.preventDefault();
    const v = editarAtencionSchema.safeParse({
      diagnostico,
      observaciones: observaciones || undefined,
      motivo,
      tratamientos: lineas.filter((l) => l.tratamientoId).map((l) => ({ tratamientoId: Number(l.tratamientoId), piezaDental: l.piezaDental })),
    });
    if (!v.success) {
      const c: Record<string, string> = {};
      for (const i of v.error.issues) c[i.path.join('.')] ??= i.message;
      return setErrores(c);
    }
    setErrores({});
    guardar.mutate(v.data);
  }

  if (atencion.isLoading) return <p className="text-muted">Cargando…</p>;
  if (atencion.isError || !atencion.data) {
    return <div className="alert alert-warning">{atencion.isError ? mensajeError(atencion.error) : MENSAJES.ATENCION_NO_EDITABLE} <Link to="/atencion">Volver</Link></div>;
  }
  const a = atencion.data;

  if (resultado) {
    return (
      <div className="tarjeta">
        <h1 className="h5">Atención corregida</h1>
        <p>La versión anterior quedó guardada en el historial clínico de {a.paciente.nombres} {a.paciente.apellidos}, con el motivo indicado.</p>
        {resultado.insumos.length > 0 && (
          <>
            <h2 className="h6">Stock corregido</h2>
            <ul className="small">
              {resultado.insumos.map((i) => (
                <li key={i.insumo}>
                  {i.insumo}: {Number(i.cantidad) > 0 ? `+${Number(i.cantidad)} (devuelto)` : `${Number(i.cantidad)} (descontado)`} {i.unidad} · quedan {Number(i.saldo)}
                </li>
              ))}
            </ul>
          </>
        )}
        {resultado.alertas.length > 0 && <div className="alert alert-warning">Stock mínimo alcanzado: {resultado.alertas.join(', ')}.</div>}
        <div className="d-flex gap-2">
          <Link to="/atencion" className="btn btn-acento">Mis citas del día</Link>
          <Link to={`/historial?paciente=${a.paciente.id}`} className="btn btn-outline-secondary">Ver historial</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-3">
        <h1 className="h4 mb-0">Editar atención</h1>
        <Link to="/atencion" className="small">← Mis citas del día</Link>
      </div>
      <p className="mb-3">
        <strong>{a.paciente.nombres} {a.paciente.apellidos}</strong> · {fechaPE(a.fecha)} {a.hora} · {a.motivo}
      </p>
      {cobrada && <div className="alert alert-info small">Esta atención ya fue cobrada: solo puede corregir el diagnóstico y las observaciones. Para cambiar los tratamientos, pida en caja que anulen el comprobante.</div>}

      <form className="tarjeta" onSubmit={enviar} noValidate style={{ maxWidth: 720 }}>
        <div className="mb-3">
          <label htmlFor="diagnostico" className="form-label">Diagnóstico *</label>
          <textarea id="diagnostico" rows={2} className={`form-control ${errores.diagnostico ? 'is-invalid' : ''}`} value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} />
          <div className="invalid-feedback">{errores.diagnostico}</div>
        </div>

        <span className="form-label d-block">Tratamientos *</span>
        {errores.tratamientos && <div className="text-danger small mb-2">{errores.tratamientos}</div>}
        {lineas.map((l, n) => (
          <div className="border rounded p-2 mb-2" key={l.clave}>
            <div className="d-flex gap-2 mb-2">
              <select aria-label={`Tratamiento ${n + 1}`} className="form-select" value={l.tratamientoId} disabled={cobrada} onChange={(e) => actualizar(l.clave, { tratamientoId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Seleccione…</option>
                {opciones.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre} — {solesPE(t.precio)}</option>
                ))}
              </select>
              {!cobrada && lineas.length > 1 && (
                <button type="button" className="btn btn-outline-secondary" aria-label={`Quitar tratamiento ${n + 1}`} onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>✕</button>
              )}
            </div>
            {!cobrada ? (
              <PiezaDental valor={l.piezaDental} onCambiar={(p) => actualizar(l.clave, { piezaDental: p })} />
            ) : (
              l.piezaDental && <div className="small text-muted">Pieza {l.piezaDental}</div>
            )}
          </div>
        ))}
        {!cobrada && (
          <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={() => setLineas((ls) => [...ls, { clave: siguienteClave++, tratamientoId: '' }])}>
            + Agregar otro tratamiento
          </button>
        )}
        {!cobrada && <p className="small text-muted">Si cambia los tratamientos, el stock de insumos se corrige solo. Los que se mantienen conservan su precio.</p>}

        <div className="mb-3">
          <label htmlFor="observaciones" className="form-label">Observaciones</label>
          <textarea id="observaciones" rows={2} className="form-control" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>
        <div className="mb-3">
          <label htmlFor="motivo" className="form-label">Motivo de la corrección *</label>
          <input id="motivo" className={`form-control ${errores.motivo ? 'is-invalid' : ''}`} placeholder="p. ej. Me equivoqué de pieza" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="invalid-feedback">{errores.motivo}</div>
        </div>
        {guardar.isError && <div className="alert alert-danger" role="alert">{mensajeError(guardar.error)}</div>}
        <button type="submit" className="btn btn-acento w-100" disabled={guardar.isPending}>{guardar.isPending ? 'Guardando…' : 'Guardar corrección'}</button>
      </form>
    </>
  );
}
