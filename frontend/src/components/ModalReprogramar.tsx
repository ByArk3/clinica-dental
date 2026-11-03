import { useState } from 'react';
import { Modal } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { citasApi, type Cita } from '../api/recursos';
import { SelectorHorarios } from './SelectorHorarios';
import { fechaPE, hoyLima, mensajeError } from '../formato';

/** CU-07 Reprogramar: elegir nuevo horario (CU-05) para una cita existente. */
export function ModalReprogramar({ cita, onCerrar }: { cita: Cita | null; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [odontologoId, setOdontologoId] = useState<number | null>(null);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState<string | null>(null);
  const odId = odontologoId ?? cita?.odontologoId ?? 0;

  const odontologos = useQuery({ queryKey: ['odontologos'], queryFn: citasApi.odontologos, enabled: !!cita });
  const disponibilidad = useQuery({
    queryKey: ['disponibilidad', odId, fecha],
    queryFn: () => citasApi.disponibilidad(odId, fecha),
    enabled: !!cita && !!fecha,
  });
  const guardar = useMutation({
    mutationFn: () => citasApi.reprogramar(cita!.id, { odontologoId: odId, fecha, hora: hora! }),
    onSuccess: () => {
      qc.invalidateQueries();
      cerrar();
    },
    onError: (e) => {
      if (e && typeof e === 'object' && 'datos' in e && (e as { datos: { codigo: string } }).datos.codigo === 'HORARIO_NO_DISPONIBLE') {
        setHora(null);
        disponibilidad.refetch();
      }
    },
  });

  function cerrar() {
    setOdontologoId(null);
    setFecha('');
    setHora(null);
    guardar.reset();
    onCerrar();
  }

  return (
    <Modal show={!!cita} onHide={cerrar} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">Reprogramar cita</Modal.Title>
      </Modal.Header>
      {cita && (
        <Modal.Body>
          <p className="small text-muted">Cita actual: {fechaPE(cita.fecha)} a las {cita.hora} con {cita.odontologo}</p>
          <div className="row g-2 mb-3">
            <div className="col-sm-6">
              <label htmlFor="r-odontologo" className="form-label">Odontólogo</label>
              <select id="r-odontologo" className="form-select" value={odId} onChange={(e) => { setOdontologoId(Number(e.target.value)); setHora(null); }}>
                {odontologos.data?.map((o) => <option key={o.id} value={o.id}>{o.nombres}</option>)}
              </select>
            </div>
            <div className="col-sm-6">
              <label htmlFor="r-fecha" className="form-label">Nueva fecha</label>
              <input id="r-fecha" type="date" min={hoyLima()} className="form-control" value={fecha} onChange={(e) => { setFecha(e.target.value); setHora(null); }} />
            </div>
          </div>
          <SelectorHorarios disponibilidad={disponibilidad.data} cargando={disponibilidad.isFetching} seleccionado={hora} onSeleccionar={setHora} onIrAFecha={(f) => { setFecha(f); setHora(null); }} />
          {guardar.isError && <div className="alert alert-danger mt-3 mb-0" role="alert">{mensajeError(guardar.error)}</div>}
        </Modal.Body>
      )}
      <Modal.Footer>
        <button className="btn btn-outline-secondary" onClick={cerrar}>Volver</button>
        <button className="btn btn-acento" disabled={!hora || guardar.isPending} onClick={() => guardar.mutate()}>
          {hora ? `Cambiar a las ${hora}` : 'Elija un horario'}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
