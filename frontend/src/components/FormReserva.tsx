import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { citaSchema } from '@clinica/shared';
import { citasApi, type Cita } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { SelectorHorarios } from './SelectorHorarios';
import { fechaPE, hoyLima, solesPE } from '../formato';
import { ChipEstado } from './ChipEstado';
import { PanelPagoAdelanto } from './PanelPagoAdelanto';

interface Props {
  /** Presencial: paciente buscado por DNI. Web: undefined (el servidor usa el de la sesión). */
  pacienteId?: number;
  onRegistrada?: (cita: Cita) => void;
}

/** Pasos 2–3 de CU-06, comunes a la reserva web y a la presencial. */
export function FormReserva({ pacienteId, onRegistrada }: Props) {
  const qc = useQueryClient();
  const [odontologoId, setOdontologoId] = useState<number | ''>('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [registrada, setRegistrada] = useState<{ cita: Cita; aviso?: string } | null>(null);
  const [tratamientoId, setTratamientoId] = useState<number | ''>('');
  const tarifario = useQuery({ queryKey: ['tarifario-publico'], queryFn: citasApi.tarifario, staleTime: 5 * 60_000 });

  const odontologos = useQuery({ queryKey: ['odontologos'], queryFn: citasApi.odontologos });
  const disponibilidad = useQuery({
    queryKey: ['disponibilidad', odontologoId, fecha],
    queryFn: () => citasApi.disponibilidad(Number(odontologoId), fecha),
    enabled: !!odontologoId && !!fecha,
  });

  const grabar = useMutation({
    mutationFn: citasApi.registrar,
    onSuccess: (r) => {
      setRegistrada(r);
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
      qc.invalidateQueries({ queryKey: ['mis-citas'] });
      onRegistrada?.(r.cita);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setError(e.datos.mensaje);
        setErrores(e.datos.campos ?? {});
        // 8.1: el horario lo tomó otra persona → recargar horarios y deseleccionar
        if (e.datos.codigo === 'HORARIO_NO_DISPONIBLE') {
          setHora(null);
          disponibilidad.refetch();
        }
      } else setError('No se pudo conectar con el servidor');
    },
  });

  const cambiarFecha = (f: string) => {
    setFecha(f);
    setHora(null);
  };

  function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const datos = { pacienteId, odontologoId: Number(odontologoId) || 0, fecha, hora: hora ?? '', motivo, ...(tratamientoId ? { tratamientoPrevistoId: Number(tratamientoId) } : {}) };
    const v = citaSchema.safeParse(datos);
    if (!v.success) {
      const campos: Record<string, string> = {};
      for (const i of v.error.issues) campos[i.path.join('.')] ??= i.message;
      if (!hora) campos.hora = 'Elija un horario';
      setErrores(campos);
      return;
    }
    setErrores({});
    grabar.mutate(v.data);
  }

  if (registrada) {
    const { cita, aviso } = registrada;
    return (
      <div className="tarjeta">
        <h2 className="h5">Cita registrada</h2>
        <p className="mb-1">
          {fechaPE(cita.fecha)} a las {cita.hora} con {cita.odontologo}
        </p>
        <p>
          <ChipEstado estado={cita.estado} />
        </p>
        {cita.estado === 'pendiente_adelanto' || cita.estado === 'pago_en_verificacion' ? (
          <>
            {aviso && <div className="alert alert-warning">{aviso}</div>}
            <div className="mb-3">
              <PanelPagoAdelanto cita={cita} modo={pacienteId ? 'presencial' : 'web'} onReportado={(c) => setRegistrada({ cita: c })} />
            </div>
          </>
        ) : (
          <p className="text-muted small">48 horas antes recibirá un enlace para confirmarla. Si no la confirma 24 horas antes, el horario se libera.</p>
        )}
        <button className="btn btn-acento" onClick={() => { setRegistrada(null); setHora(null); setMotivo(''); }}>
          Registrar otra cita
        </button>
      </div>
    );
  }

  return (
    <form className="tarjeta" onSubmit={enviar} noValidate>
      <div className="mb-3">
        <label htmlFor="motivo" className="form-label">Motivo</label>
        <input id="motivo" className={`form-control ${errores.motivo ? 'is-invalid' : ''}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: dolor de muela, limpieza" />
        <div className="invalid-feedback">{errores.motivo}</div>
      </div>
      <div className="mb-3">
        <label htmlFor="tratamiento-previsto" className="form-label">Tratamiento previsto</label>
        <select id="tratamiento-previsto" className={`form-select ${errores.tratamientoPrevistoId ? 'is-invalid' : ''}`} value={tratamientoId} onChange={(e) => setTratamientoId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">No sé / Consulta</option>
          {tarifario.data?.filter((t) => t.nombre !== 'Consulta').map((t) => (
            <option key={t.id} value={t.id}>{t.nombre} — {solesPE(t.precio)}</option>
          ))}
        </select>
        <div className="invalid-feedback">{errores.tratamientoPrevistoId}</div>
        <div className="form-text">Si la cita es en menos de 24 horas (o tiene 3 faltas), se pide un adelanto del 50 % de este tratamiento.</div>
      </div>
      <div className="row g-3 mb-3">
        <div className="col-sm-6">
          <label htmlFor="odontologo" className="form-label">Odontólogo</label>
          <select id="odontologo" className={`form-select ${errores.odontologoId ? 'is-invalid' : ''}`} value={odontologoId} onChange={(e) => { setOdontologoId(e.target.value ? Number(e.target.value) : ''); setHora(null); }}>
            <option value="">Seleccione…</option>
            {odontologos.data?.map((o) => (
              <option key={o.id} value={o.id}>{o.nombres}{o.especialidad ? ` — ${o.especialidad}` : ''}</option>
            ))}
          </select>
          <div className="invalid-feedback">{errores.odontologoId}</div>
        </div>
        <div className="col-sm-6">
          <label htmlFor="fecha" className="form-label">Fecha</label>
          <input id="fecha" type="date" min={hoyLima()} className={`form-control ${errores.fecha ? 'is-invalid' : ''}`} value={fecha} onChange={(e) => cambiarFecha(e.target.value)} />
          <div className="invalid-feedback">{errores.fecha && 'Elija una fecha'}</div>
        </div>
      </div>
      <div className="mb-3">
        <span className="form-label d-block">Horario</span>
        <SelectorHorarios disponibilidad={disponibilidad.data} cargando={disponibilidad.isFetching} seleccionado={hora} onSeleccionar={setHora} onIrAFecha={cambiarFecha} />
        {errores.hora && <div className="text-danger small mt-1">{errores.hora}</div>}
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <button type="submit" className="btn btn-acento w-100" disabled={grabar.isPending}>
        {grabar.isPending ? 'Registrando…' : hora ? `Reservar a las ${hora}` : 'Reservar cita'}
      </button>
    </form>
  );
}
