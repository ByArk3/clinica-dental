import { ETIQUETA_ESTADO_PEDIDO, type EstadoPedido } from '@clinica/shared';

const CLASE: Record<EstadoPedido, string> = {
  pendiente: 'chip-pendiente_confirmacion',
  recibido: 'chip-pagada',
  recibido_con_diferencias: 'chip-pendiente_adelanto',
  anulado: 'chip-cancelada',
};
export const ChipPedido = ({ estado }: { estado: EstadoPedido }) => <span className={`chip ${CLASE[estado]}`}>{ETIQUETA_ESTADO_PEDIDO[estado]}</span>;
