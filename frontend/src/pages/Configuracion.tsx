import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BILLETERAS, configPagoSchema, LARGO_NUMERICO, soloDigitos, descuentoSchema, ETIQUETA_BILLETERA, feriadoSchema, HORARIO_CLINICA, nombreBilleteras, type Billetera, type DescuentoDTO } from '@clinica/shared';
import { citasApi, configApi, tarifarioApi, type DatosPago, type Descuento } from '../api/recursos';
import { BotonAccion, CampoDigitos } from '../components/Interaccion';
import { camposApi, erroresZod, fechaPE, hoyLima, mensajeError } from '../formato';
import { hoyEnLima } from '@clinica/shared';

type Pestana = 'campanas' | 'feriados' | 'horarios' | 'pagos';
const PESTANAS: [Pestana, string][] = [
  ['campanas', 'Campañas de descuento'],
  ['feriados', 'Feriados'],
  ['horarios', 'Horarios de odontólogos'],
  ['pagos', 'Pagos (Yape / Plin)'],
];

/** Configuración del Administrador: campañas, feriados, horario de cada odontólogo y datos de pago del adelanto. */
export default function Configuracion() {
  const [pestana, setPestana] = useState<Pestana>('campanas');
  return (
    <>
      <h1 className="h4 mb-3">Configuración</h1>
      <ul className="nav nav-tabs mb-3 flex-nowrap desplazable">
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
  const NUM: Partial<Record<string, number>> = { porcentaje: LARGO_NUMERICO.porcentaje, edadMaxima: LARGO_NUMERICO.edad };
  const alternar = (id: number) => setV({ ...v, tratamientos: v.tratamientos.includes(id) ? v.tratamientos.filter((x) => x !== id) : [...v.tratamientos, id] });
  const campo = (k: 'nombre' | 'porcentaje' | 'fechaInicio' | 'fechaFin' | 'edadMaxima', etiqueta: string, col: string, tipo = 'text') => (
    <div className={col}>
      <label htmlFor={`c-${k}`} className="form-label">{etiqueta}</label>
      <input
        id={`c-${k}`}
        type={tipo}
        {...(k === 'fechaFin' ? { min: hoyEnLima() } : {})}
        inputMode={NUM[k] ? 'numeric' : undefined}
        maxLength={NUM[k]}
        className={`form-control ${errores[k] ? 'is-invalid' : ''}`}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: NUM[k] ? soloDigitos(e.target.value, NUM[k]!) : e.target.value })}
      />
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
          <BotonAccion mutacion={guardar}>Guardar</BotonAccion>
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
            <input id="f-fecha" type="date" min={hoyEnLima()} className={`form-control ${errores.fecha ? 'is-invalid' : ''}`} value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.target.value })} />
            <div className="invalid-feedback">{errores.fecha}</div>
          </div>
          <div className="mb-3">
            <label htmlFor="f-nombre" className="form-label small mb-1">Nombre</label>
            <input id="f-nombre" className={`form-control ${errores.nombre ? 'is-invalid' : ''}`} value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} placeholder="Ej.: Aniversario de la clínica" />
            <div className="invalid-feedback">{errores.nombre}</div>
          </div>
          <BotonAccion className="btn btn-acento w-100" mutacion={crear}>Agregar</BotonAccion>
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
const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const aHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ALMUERZO_MIN = 60;

/** Tramo que propone «+ Tramo»: 1 h después del último del día (almuerzo) hasta el cierre; null si ya no hay espacio. */
export function siguienteTramo(delDia: Tramo[], dia: number): Tramo | null {
  if (delDia.length === 0) return { diaSemana: dia, horaInicio: HORARIO_CLINICA.apertura, horaFin: '14:00' };
  const inicio = Math.max(...delDia.map((t) => aMin(t.horaFin))) + ALMUERZO_MIN;
  if (inicio + 30 > aMin(HORARIO_CLINICA.cierre)) return null;
  return { diaSemana: dia, horaInicio: aHora(inicio), horaFin: HORARIO_CLINICA.cierre };
}

/** Pares de tramos del mismo día que se pisan → por índice, el texto «se cruza con …». */
export function cruces(tramos: Tramo[]) {
  const r = new Map<number, string>();
  tramos.forEach((a, i) =>
    tramos.forEach((b, j) => {
      if (i !== j && a.diaSemana === b.diaSemana && aMin(a.horaInicio) < aMin(b.horaFin) && aMin(b.horaInicio) < aMin(a.horaFin)) {
        r.set(i, `${a.horaInicio}–${a.horaFin} se cruza con ${b.horaInicio}–${b.horaFin}`);
      }
    }),
  );
  return r;
}

function Horarios() {
  const qc = useQueryClient();
  const odontologos = useQuery({ queryKey: ['odontologos'], queryFn: citasApi.odontologos });
  const [id, setId] = useState<number | null>(null);
  const actual = id ?? odontologos.data?.[0]?.id ?? null;
  const horario = useQuery({ queryKey: ['horario', actual], queryFn: () => configApi.horario(actual!), enabled: !!actual });
  const [tramos, setTramos] = useState<Tramo[]>([]);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (horario.data) setTramos(horario.data.tramos); setOk(false); }, [horario.data]);
  const choques = cruces(tramos);
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
        const propuesto = siguienteTramo(del.map((x) => x.t), dia);
        const errorDia = del.map((x) => choques.get(x.i)).find(Boolean);
        return (
          <div key={dia} className="d-flex flex-wrap align-items-center gap-2 py-2 border-bottom">
            <strong style={{ width: 90 }}>{nombre}</strong>
            {del.length === 0 && <span className="small text-muted">No atiende</span>}
            {del.map(({ t, i }) => (
              <span key={i} className="d-inline-flex align-items-center gap-1">
                <select aria-label={`${nombre} desde`} className={`form-select form-select-sm ${choques.has(i) ? 'tramo-cruce' : ''}`} style={{ width: 92 }} value={t.horaInicio} onChange={(e) => cambiar(i, { horaInicio: e.target.value })}>
                  {horas.slice(0, -1).map((h) => <option key={h}>{h}</option>)}
                </select>
                –
                <select aria-label={`${nombre} hasta`} className={`form-select form-select-sm ${choques.has(i) ? 'tramo-cruce' : ''}`} style={{ width: 92 }} value={t.horaFin} onChange={(e) => cambiar(i, { horaFin: e.target.value })}>
                  {horas.slice(1).map((h) => <option key={h}>{h}</option>)}
                </select>
                <button type="button" className="btn btn-sm btn-link text-danger px-1" aria-label={`Quitar tramo del ${nombre}`} onClick={() => { setOk(false); setTramos(tramos.filter((_, k) => k !== i)); }}>✕</button>
              </span>
            ))}
            {del.length > 1 && !errorDia && (() => {
              // hueco entre tramos (p. ej. el almuerzo)
              const orden = [...del].sort((a, b) => aMin(a.t.horaInicio) - aMin(b.t.horaInicio));
              const pausa = orden.slice(1).map((x, k) => [orden[k].t.horaFin, x.t.horaInicio]).find(([a, b]) => aMin(b) > aMin(a));
              return pausa ? <span className="small text-success">🍽 Pausa {pausa[0]}–{pausa[1]}</span> : null;
            })()}
            <span className="ms-auto" title={propuesto ? undefined : `No queda horario antes del cierre (${HORARIO_CLINICA.cierre})`}>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={!propuesto}
                onClick={() => {
                  if (!propuesto) return;
                  setOk(false);
                  setTramos([...tramos, propuesto]);
                }}
              >
                + Tramo
              </button>
            </span>
            {errorDia && <div className="w-100 small text-danger" style={{ paddingLeft: 98 }} role="alert">⚠ {errorDia}. Corríjalo antes de guardar.</div>}
          </div>
        );
      })}
      <p className="small text-muted mt-2">Domingo no se atiende. Dentro de {HORARIO_CLINICA.apertura}–{HORARIO_CLINICA.cierre}, en bloques de 30 minutos. Las citas ya registradas no cambian.</p>
      {guardar.isError && <div className="alert alert-danger" role="alert">{mensajeError(guardar.error)}</div>}
      {ok && <div className="alert alert-success py-2">Horario guardado.</div>}
      <BotonAccion mutacion={guardar} disabled={!actual || choques.size > 0} title={choques.size ? 'Hay tramos que se cruzan' : undefined} onClick={() => guardar.mutate()}>
        Guardar horario
      </BotonAccion>
    </div>
  );
}

// ---------------------------------------------------------------- Pagos
function Pagos() {
  const qc = useQueryClient();
  const datos = useQuery({ queryKey: ['admin-pago'], queryFn: configApi.datosPago });
  const [v, setV] = useState<{ numero: string; titular: string; billeteras: Billetera[]; saldoVigenciaMeses: string }>({ numero: '', titular: '', billeteras: ['yape'], saldoVigenciaMeses: '12' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  const [version, setVersion] = useState(() => String(Date.now()));
  useEffect(() => {
    if (datos.data) setV({ numero: datos.data.numero ?? '', titular: datos.data.titular ?? '', billeteras: datos.data.billeteras, saldoVigenciaMeses: String(datos.data.saldoVigenciaMeses) });
  }, [datos.data]);
  const alGuardar = (texto: string) => (d: DatosPago) => {
    qc.setQueryData(['admin-pago'], d);
    qc.invalidateQueries({ queryKey: ['datos-pago'] });
    setVersion(String(Date.now()));
    setOk(texto);
  };
  const guardar = useMutation({ mutationFn: configApi.guardarDatosPago, onSuccess: alGuardar('Datos guardados.'), onError: (e) => setErrores(camposApi(e)) });
  const subir = useMutation({ mutationFn: configApi.subirQr, onSuccess: alGuardar('QR actualizado.'), onError: (e) => setErrores({ qr: mensajeError(e) }) });
  const quitar = useMutation({ mutationFn: configApi.quitarQr, onSuccess: alGuardar('QR quitado.') });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    const r = configPagoSchema.safeParse(v);
    if (!r.success) return setErrores(erroresZod(r.error.issues));
    setErrores({});
    guardar.mutate(r.data);
  }
  function elegirQr(f: File | undefined) {
    setOk(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setErrores({ qr: 'El QR debe ser una imagen PNG, JPG o WEBP' });
    if (f.size > 2 * 1024 * 1024) return setErrores({ qr: 'El QR no debe pasar de 2 MB' });
    setErrores({});
    const lector = new FileReader();
    lector.onload = () => subir.mutate(String(lector.result));
    lector.readAsDataURL(f);
  }
  const marcar = (b: Billetera, si: boolean) => setV({ ...v, billeteras: si ? [...v.billeteras, b] : v.billeteras.filter((x) => x !== b) });

  return (
    <div className="row g-3">
      <div className="col-lg-6">
        <form className="tarjeta h-100" onSubmit={enviar} noValidate>
          <h2 className="h6">Billetera digital de la clínica</h2>
          <p className="small text-muted">Se muestra al paciente para pagar el adelanto de toda reserva (50 % del tratamiento; 100 % con 3 o más inasistencias; plazo de 1 hora). La recepcionista verifica cada pago en Caja.</p>
          <span className="form-label d-block">Billeteras que acepta la clínica</span>
          <div className="mb-2">
            {BILLETERAS.map((b) => (
              <div className="form-check form-check-inline" key={b}>
                <input id={`b-${b}`} type="checkbox" className={`form-check-input ${errores.billeteras ? 'is-invalid' : ''}`} checked={v.billeteras.includes(b)} onChange={(e) => marcar(b, e.target.checked)} />
                <label htmlFor={`b-${b}`} className="form-check-label">{ETIQUETA_BILLETERA[b]}</label>
              </div>
            ))}
            {errores.billeteras && <div className="text-danger small">{errores.billeteras}</div>}
            <div className="form-text">En Caja, el tipo de pago se llamará «{nombreBilleteras(v.billeteras) || '—'}».</div>
          </div>
          <div className="mb-2">
            <label htmlFor="p-numero" className="form-label">Celular</label>
            <CampoDigitos id="p-numero" value={v.numero} onChange={(x) => setV({ ...v, numero: x })} largo={LARGO_NUMERICO.celular} error={errores.numero} />
          </div>
          <div className="mb-3">
            <label htmlFor="p-titular" className="form-label">Titular</label>
            <input id="p-titular" className={`form-control ${errores.titular ? 'is-invalid' : ''}`} value={v.titular} onChange={(e) => setV({ ...v, titular: e.target.value })} />
            <div className="invalid-feedback">{errores.titular}</div>
          </div>
          <div className="mb-3">
            <label htmlFor="p-vigencia" className="form-label">Vigencia del saldo a favor (meses)</label>
            <input id="p-vigencia" inputMode="numeric" maxLength={2} style={{ maxWidth: 120 }} className={`form-control ${errores.saldoVigenciaMeses ? 'is-invalid' : ''}`} value={v.saldoVigenciaMeses} onChange={(e) => setV({ ...v, saldoVigenciaMeses: soloDigitos(e.target.value, 2) })} />
            <div className="invalid-feedback">{errores.saldoVigenciaMeses}</div>
            <div className="form-text">0 = no vence. Se avisa al paciente por correo 30 y 7 días antes de que venza.</div>
          </div>
          <BotonAccion mutacion={guardar}>Guardar</BotonAccion>
        </form>
      </div>
      <div className="col-lg-6">
        <div className="tarjeta h-100">
          <h2 className="h6">QR de pago</h2>
          <p className="small text-muted">El paciente lo escanea desde su app en vez de escribir el número. En Yape: «Mi QR» → Compartir o Descargar.</p>
          {datos.data?.tieneQr ? (
            <img src={citasApi.qrUrl(version)} alt="QR de pago de la clínica" className="border rounded bg-white p-1 mb-2 d-block" style={{ width: 180, height: 180, objectFit: 'contain' }} />
          ) : (
            <p className="text-muted small">Todavía no hay un QR cargado.</p>
          )}
          <label htmlFor="p-qr" className="form-label">{datos.data?.tieneQr ? 'Reemplazar QR' : 'Subir QR'} (PNG, JPG o WEBP, máx. 2 MB)</label>
          <input id="p-qr" type="file" accept="image/png,image/jpeg,image/webp" className={`form-control ${errores.qr ? 'is-invalid' : ''}`} disabled={subir.isPending} onChange={(e) => { elegirQr(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="invalid-feedback">{errores.qr}</div>
          {datos.data?.tieneQr && (
            <button type="button" className="btn btn-sm btn-outline-danger mt-2" disabled={quitar.isPending} onClick={() => { setOk(null); quitar.mutate(); }}>Quitar QR</button>
          )}
        </div>
      </div>
      {ok && <div className="col-12"><div className="alert alert-success py-2 mb-0" role="status">{ok}</div></div>}
    </div>
  );
}
