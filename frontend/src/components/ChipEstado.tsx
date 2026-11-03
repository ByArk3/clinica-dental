import { ETIQUETA_ESTADO_CITA, type EstadoCita } from '@clinica/shared';

export function ChipEstado({ estado }: { estado: EstadoCita }) {
  return <span className={`chip chip-${estado}`}>{ETIQUETA_ESTADO_CITA[estado]}</span>;
}
