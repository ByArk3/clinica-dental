import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configPagoSchema, descuentoSchema, feriadoSchema, HORARIO_CLINICA, type DescuentoDTO } from '@clinica/shared';
import { citasApi, configApi, tarifarioApi, type Descuento } from '../api/recursos';
import { camposApi, erroresZod, fechaPE, hoyLima, mensajeError } from '../formato';

type Pestana = 'campanas' | 'feriados' | 'horarios' | 'pagos';
const PESTANAS: [Pestana, string][] = [
  ['campanas', 'Campañas de descuento'],
  ['feriados', 'Feriados'],
  ['horarios', 'Horarios de odontólogos'],
  ['pagos', 'Pagos con Yape/Plin'],
];

/** Configuración del Administrador: campañas, feriados, horario de cada odontólogo y datos de pago del adelanto. */
export default function Configuracion() {
  const [pestana, setPestana] = useState<Pestana>('campanas');
  return (
    <>
      <h1 className="h4 mb-3">Configuración</h1>
      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        {PESTANAS.map(([k, t]) => (
          <li className="nav-item" key={k}>
            <button className={`nav-link text-nowrap ${pestana === k ? 'active' : ''}`} onClick={() => setPestana(k)}>{t}</button>
          </li>
        ))}
      </ul>
      {pestana === 'campanas' && <Campanas />}
      {pestana === 'feriados' && <Feriados />}
      {pestana === 'horarios' && <Horarios />}
      {pestana === 'pagos' && <Pagos />}
    </>
  );
}

// ---------------------------------------------------------------- Campañas
function Campanas() {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['admin-descuentos'], queryFn: configApi.descuentos });
  const [editando, setEditando] = useState<Descuento | 'nueva' | null>(null);
  const estado = useMutation({ mutationFn: (d: Descuento) => configApi.estadoDescuento(d.id, !d.activo), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-descuentos'] }) });
  const hoy = hoyLima();
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <p className="small text-muted mb-0">Se aplican solas en caja según la fecha de la cita. Si dos aplican a un mismo tratamiento, gana la mayor.</p>
        <button className="btn btn-acento" onClick={() => setEditando('nueva')}>+ Nueva campaña</button>
      </div>
      <div className="tarjeta p-0">
        <div className="table-responsive">
          <table className="table align-middle mb-0 small">
            <thead><tr><th>Campaña</th><th>Vigencia</th><th>Descuento</th><th>Tratamientos</th><th></th></tr></thead>
            <tbody>
              {lista.data?.map((d) => {
                const vigente = d.activo && d.fechaInicio <= hoy && hoy <= d.fechaFin;
                return (
                  <tr key={d.id} className={d.activo ? '' : 'text-muted'}>
                    <td>{d.nombre} {vigente && <span className="badge text-bg-success">Vigente</span>} {!d.activo && <span className="badge text-bg-secondary">Desactivada</span>}</td>
                    <td className="text-nowrap">{fechaPE(d.fechaInicio)} – {fechaPE(d.fechaFin)}</td>
                    <td className="text-nowrap">{d.tipo === 'tres_por_dos' ? '3x2' : `${Number(d.porcentaje)} %`}{d.edadMaxima !== null && <div className="text-muted">hasta {d.edadMaxima} años</div>}</td>
                    <td>{d.tratamientos.map((t) => t.nombre).join(', ')}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEditando(d)}>Modificar</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => estado.mutate(d)}>{d.activo ? 'Desactivar' : 'Activar'}</button>
                    </td>
                  </tr>
                );
              })}
              {lista.data?.length === 0 && <tr><td colSpan={5} className="text-muted">No hay campañas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editando && <FormCampana campana={editando === 'nueva' ? null : editando} onCerrar={() => setEditando(null)} />}
    </>
  );
}

function FormCampana({ campana, onCerrar }: { campana: Descuento | null; onCerrar: () => void }) {
  const qc = useQueryClient();
  const tratamientos = useQuery({ queryKey: ['tarifario', '', '1'], queryFn: () => tarifarioApi.listar({ activo: '1' }) });
  const [v, setV] = useState({
    nombre: campana?.nombre ?? '',
    tipo: campana?.tipo ?? ('porcentaje' as 'porcentaje' | 'tres_por_dos'),
    porcentaje: campana?.porcentaje ? String(Number(campana.porcentaje)) : '',
    fechaInicio: campana?.fechaInicio ?? '',
    fechaFin: campana?.fechaFin ?? '',
    edadMaxima: campana?.edadMaxima !== null && campana?.edadMaxima !== undefined ? String(campana.edadMaxima) : '',
    tratamientos: campana?.tratamientos.map((t) => t.id) ?? ([] as number[]),
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const guardar = useMutation({
    mutationFn: (d: DescuentoDTO) => (campana ? configApi.modificarDescuento(campana.id, d) : configApi.crearDescuento(d)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-descuentos'] }); onCerrar(); },
    onError: (e) => setErrores(camposApi(e)),
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = descuentoSchema.safeParse({
      ...v,
      porcentaje: v.tipo === 'porcentaje' && v.porcentaje !== '' ? v.porcentaje : null,
      edadMaxima: v.edadMaxima === '' ? null : v.edadMaxima,
    });
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }
  const alternar = (id: number) => setV({ ...v, tratamientos: v.tratamientos.includes(id) ? v.tratamientos.filter((x) => x !== id) : [...v.tratamientos, id] });
  const campo = (k: 'nombre' | 'porcentaje' | 'fechaInicio' | 'fechaFin' | 'edadMaxima', etiqueta: string, col: string, tipo = 'text') => (
    <div className={col}>
      <label htmlFor={`c-${k}`} className="form-label">{etiqueta}</label>
      <input id={`c-${k}`} type={tipo} inputMode={k === 'porcentaje' || k === 'edadMaxima' ? 'numeric' : undefined} className={`form-control ${errores[k] ? 'is-invalid' : ''}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <div className="invalid-feedback">{errores[k]}</div>
    </div>
  );
  return (
    <Modal show onHide={onCerrar} centered size="lg">
      <form onSubmit={enviar} noValidate>
        <Modal.Header closeButton><Modal.Title className="h5">{campana ? 'Modificar campaña' : 'Nueva campaña'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="row g-3">
            {campo('nombre', 'Nombre', 'col-12')}
            <div className="col-sm-5">
              <span className="form-label d-block">Tipo</span>
              <div className="btn-group" role="radiogroup" aria-label="Tipo de campaña">
                <button type="button" role="radio" aria-checked={v.tipo === 'porcentaje'} className={`btn btn-sm ${v.tipo === 'porcentaje' ? 'btn-acento' : 'btn-outline-secondary'}`} onClick={() => setV({ ...v, tipo: 'porcentaje' })}>Porcentaje</button>
                <button type="button" role="radio" aria-checked={v.tipo === 'tres_por_dos'} className={`btn btn-sm ${v.tipo === 'tres_por_dos' ? 'btn-acento' : 'btn-outline-secondary'}`} onClick={() => setV({ ...v, tipo: 'tres_por_dos' })}>3x2</button>
              </div>
            </div>
            {v.tipo === 'porcentaje' ? campo('porcentaje', 'Descuento (%)', 'col-sm-3') : <div className="col-sm-3 small text-muted align-self-end">Cada 3, la de menor precio sale gratis.</div>}
            {campo('edadMaxima', 'Edad máxima (opcional)', 'col-sm-4')}
            {campo('fechaInicio', 'Desde', 'col-sm-6', 'date')}
            {campo('fechaFin', 'Hasta', 'col-sm-6', 'date')}
            <div className="col-12">
              <span className="form-label d-block">Tratamientos</span>
              <div className="d-flex flex-wrap gap-2">
                {tratamientos.data?.map((t) => (
                  <label key={t.id} className={`btn btn-sm ${v.tratamientos.includes(t.id) ? 'btn-acento' : 'btn-outline-secondary'}`}>
                    <input type="checkbox" className="d-none" checked={v.tratamientos.includes(t.id)} onChange={() => alternar(t.id)} />
                    {t.nombre}
                  </label>
                ))}
              </div>
              {errores.tratamientos && <div className="text-danger small mt-1">{errores.tratamientos}</div>}
            </div>
          </div>
          {guardar.isError && !Object.keys(errores).length && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-acento" disabled={guardar.isPending}>Guardar</button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Feriados
function Feriados() {
  const qc = useQueryClient();
  const [anio, setAnio] = useState(Number(hoyLima().slice(0, 4)));
  const lista = useQuery({ queryKey: ['feriados', anio], queryFn: () => configApi.feriados(anio) });
  const [v, setV] = useState({ fecha: '', nombre: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [afectadas, setAfectadas] = useState<Awaited<ReturnType<typeof configApi.crearFeriado>> | null>(null);
  const crear = useMutation({
    mutationFn: configApi.crearFeriado,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['feriados'] }); setV({ fecha: '', nombre: '' }); setAfectadas(r); },
    onError: (e) => setErrores(camposApi(e)),
  });
  const eliminar = useMutation({ mutationFn: configApi.eliminarFeriado, onSuccess: () => qc.invalidateQueries({ queryKey: ['feriados'] }) });
  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = feriadoSchema.safeParse(v);
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    crear.mutate(r.data);
  }
  return (
    <div className="row g-3">
      <div className="col-lg-7">
        <div className="tarjeta">
          <div className="d-flex align-items-center gap-2 mb-2">
            <h2 className="h6 mb-0 me-auto">Feriados {anio}</h2>
            <button className="btn btn-sm btn-outline-secondary" aria-label="Año anterior" onClick={() => setAnio(anio - 1)}>‹</button>
            <button className="btn btn-sm btn-outline-secondary" aria-label="Año siguiente" onClick={() => setAnio(anio + 1)}>›</button>
          </div>
          <p className="small text-muted">Esos días la clínica no atiende y no se puede reservar.</p>
          <table className="table table-sm align-middle mb-0">
            <tbody>
              {lista.data?.map((f) => (
                <tr key={f.id}>
                  <td className="text-nowrap">{fechaPE(f.fecha)}</td>
                  <td>{f.nombre}</td>
                  <td className="text-end"><button className="btn btn-sm btn-link text-danger" onClick={() => eliminar.mutate(f.id)}>Quitar</button></td>
                </tr>
              ))}
              {lista.data?.length === 0 && <tr><td className="text-muted">Sin feriados registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="col-lg-5">
        <form className="tarjeta" onSubmit={enviar} noValidate>
          <h2 className="h6">Agregar feriado o día no laborable</h2>
          <div className="mb-2">
            <label htmlFor="f-fecha" className="form-label small mb-1">Fecha</label>
            <input id="f-fecha" type="date" className={`form-control ${errores.fecha ? 'is-invalid' : ''}`} value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.target.value })} />
            <div className="invalid-feedback">{errores.fecha}</div>
          </div>
          <div className="mb-3">
            <label htmlFor="f-nombre" className="form-label small mb-1">Nombre</label>
            <input id="f-nombre" className={`form-control ${errores.nombre ? 'is-invalid' : ''}`} value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} placeholder="Ej.: Aniversario de la clínica" />
            <div className="invalid-feedback">{errores.nombre}</div>
          </div>
          <button className="btn btn-acento w-100" disabled={crear.isPending}>Agregar</button>
          {afectadas && (
            <div className={`alert mt-3 mb-0 small ${afectadas.citasAfectadas.length ? 'alert-warning' : 'alert-success'}`}>
              Feriado del {fechaPE(afectadas.feriado.fecha)} agregado.
              {afectadas.citasAfectadas.length > 0 ? (
                <>
                  {' '}Hay {afectadas.citasAfectadas.length} cita(s) ese día que recepción debe reprogramar:
                  <ul className="mb-0 mt-1">{afectadas.citasAfectadas.map((c) => <li key={c.id}>{c.hora} · {c.paciente} ({c.telefono}) · {c.odontologo}</li>)}</ul>
                </>
              ) : ' No había citas ese día.'}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Horarios
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
interface Tramo { diaSemana: number; horaInicio: string; horaFin: string }

function Horarios() {
  const qc = useQueryClient();
  const odontologos = useQuery({ queryKey: ['odontologos'], queryFn: citasApi.odontologos });
  const [id, setId] = useState<number | null>(null);
  const actual = id ?? odontologos.data?.[0]?.id ?? null;
  const horario = useQuery({ queryKey: ['horario', actual], queryFn: () => configApi.horario(actual!), enabled: !!actual });
  const [tramos, setTramos] = useState<Tramo[]>([]);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (horario.data) setTramos(horario.data.tramos); setOk(false); }, [horario.data]);
  const guardar = useMutation({
    mutationFn: () => configApi.guardarHorario(actual!, { tramos }),
    onSuccess: (h) => { qc.setQueryData(['horario', actual], h); setOk(true); },
  });
  const cambiar = (i: number, c: Partial<Tramo>) => { setOk(false); setTramos(tramos.map((t, k) => (k === i ? { ...t, ...c } : t))); };
  const horas = Array.from({ length: 25 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

  return (
    <div className="tarjeta">
      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <div>
          <label htmlFor="h-odontologo" className="form-label small mb-1">Odontólogo</label>
          <select id="h-odontologo" className="form-select" value={actual ?? ''} onChange={(e) => setId(Number(e.target.value))}>
            {odontologos.data?.map((o) => <option key={o.id} value={o.id}>{o.nombres}</option>)}
          </select>
        </div>
        {horario.data?.usaHorarioGeneral && <span className="small text-muted pb-2">Sin horario propio: usa el general (L–S {HORARIO_CLINICA.apertura}–{HORARIO_CLINICA.cierre}).</span>}
      </div>
      {DIAS.slice(1).map((nombre, idx) => {
        const dia = idx + 1;
        const del = tramos.map((t, i) => ({ t, i })).filter((x) => x.t.diaSemana === dia);
        return (
          <div key={dia} className="d-flex flex-wrap align-items-center gap-2 py-2 border-bottom">
            <strong style={{ width: 90 }}>{nombre}</strong>
            {del.length === 0 && <span className="small text-muted">No atiende</span>}
            {del.map(({ t, i }) => (
              <span key={i} className="d-inline-flex align-items-center gap-1">
                <select aria-label={`${nombre} desde`} className="form-select form-select-sm" style={{ width: 92 }} value={t.horaInicio} onChange={(e) => cambiar(i, { horaInicio: e.target.value })}>
                  {horas.slice(0, -1).map((h) => <option key={h}>{h}</option>)}
                </select>
                –
                <select aria-label={`${nombre} hasta`} className="form-select form-select-sm" style={{ width: 92 }} value={t.horaFin} onChange={(e) => cambiar(i, { horaFin: e.target.value })}>
                  {horas.slice(1).map((h) => <option key={h}>{h}</option>)}
                </select>
                <button type="button" className="btn btn-sm btn-link text-danger px-1" aria-label={`Quitar tramo del ${nombre}`} onClick={() => { setOk(false); setTramos(tramos.filter((_, k) => k !== i)); }}>✕</button>
              </span>
            ))}
            <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={() => { setOk(false); setTramos([...tramos, { diaSemana: dia, horaInicio: '08:00', horaFin: '14:00' }]); }}>+ Tramo</button>
          </div>
        );
      })}
      <p className="small text-muted mt-2">Domingo no se atiende. Dentro de {HORARIO_CLINICA.apertura}–{HORARIO_CLINICA.cierre}, en bloques de 30 minutos. Las citas ya registradas no cambian.</p>
      {guardar.isError && <div className="alert alert-danger" role="alert">{mensajeError(guardar.error)}</div>}
      {ok && <div className="alert alert-success py-2">Horario guardado.</div>}
      <button className="btn btn-acento" disabled={guardar.isPending || !actual} onClick={() => guardar.mutate()}>Guardar horario</button>
    </div>
  );
}

// ---------------------------------------------------------------- Pagos
function Pagos() {
  const datos = useQuery({ queryKey: ['admin-pago'], queryFn: configApi.datosPago });
  const [v, setV] = useState({ numero: '', titular: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ok, setOk] = useState(false);
  useEffect(() => { if (datos.data) setV(datos.data); }, [datos.data]);
  const guardar = useMutation({ mutationFn: configApi.guardarDatosPago, onSuccess: () => setOk(true), onError: (e) => setErrores(camposApi(e)) });
  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    const r = configPagoSchema.safeParse(v);
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }
  return (
    <form className="tarjeta" style={{ maxWidth: 520 }} onSubmit={enviar} noValidate>
      <h2 className="h6">Yape / Plin de la clínica</h2>
      <p className="small text-muted">Se muestra al paciente para pagar el adelanto (50 % del tratamiento, plazo de 1 hora). La recepcionista verifica cada pago en Caja.</p>
      <div className="mb-2">
        <label htmlFor="p-numero" className="form-label">Celular</label>
        <input id="p-numero" inputMode="numeric" className={`form-control ${errores.numero ? 'is-invalid' : ''}`} value={v.numero} onChange={(e) => setV({ ...v, numero: e.target.value })} />
        <div className="invalid-feedback">{errores.numero}</div>
      </div>
      <div className="mb-3">
        <label htmlFor="p-titular" className="form-label">Titular</label>
        <input id="p-titular" className={`form-control ${errores.titular ? 'is-invalid' : ''}`} value={v.titular} onChange={(e) => setV({ ...v, titular: e.target.value })} />
        <div className="invalid-feedback">{errores.titular}</div>
      </div>
      {ok && <div className="alert alert-success py-2">Datos guardados.</div>}
      <button className="btn btn-acento" disabled={guardar.isPending}>Guardar</button>
    </form>
  );
}
