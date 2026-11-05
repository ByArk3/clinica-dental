import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { ETIQUETA_ESTADO_CITA, type EstadoCita } from '@clinica/shared';

/** Qué significa cada estado (globo al pasar el mouse o al enfocar). */
const AYUDA: Record<EstadoCita, string> = {
  pendiente_confirmacion: 'Reserva anterior al cambio de reglas: debe confirmarse con el enlace del recordatorio',
  pendiente_adelanto: 'Falta pagar el adelanto (plazo de 1 hora); si no se paga, el horario se libera',
  pago_en_verificacion: 'El paciente reportó su pago por Yape/Plin; la recepcionista debe verificarlo en Caja',
  confirmada: 'Adelanto pagado: la cita está asegurada',
  atendida: 'El odontólogo registró la atención; falta cobrar en Caja',
  pagada: 'Atención cobrada: comprobante emitido',
  cancelada: 'Cancelada por el paciente o la clínica',
  liberada: 'El horario se liberó (adelanto no pagado a tiempo o pago rechazado)',
  inasistencia: 'El paciente no asistió (cuenta para RN-12)',
};

export function ChipEstado({ estado }: { estado: EstadoCita }) {
  return (
    <OverlayTrigger placement="top" delay={{ show: 300, hide: 0 }} overlay={<Tooltip>{AYUDA[estado]}</Tooltip>}>
      <span className={`chip chip-${estado}`} tabIndex={0}>
        {ETIQUETA_ESTADO_CITA[estado]}
      </span>
    </OverlayTrigger>
  );
}
