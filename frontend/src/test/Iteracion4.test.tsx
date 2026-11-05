import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { MENSAJES } from '@clinica/shared';
import NuevoPedido from '../pages/NuevoPedido';
import RecepcionPedido from '../pages/RecepcionPedido';
import Pedidos from '../pages/Pedidos';
import Alertas from '../pages/Alertas';
import Panel from '../pages/Panel';
import Reportes from '../pages/Reportes';
import { renderizar, simularApi } from './utils';

const resina = { id: 1, nombre: 'Resina compuesta A2', unidad: 'jeringa', stockActual: '4.00', stockMinimo: '5.00', bajoMinimo: true, activo: true };
const copa = { id: 4, nombre: 'Copa de goma', unidad: 'unidad', stockActual: '12.00', stockMinimo: '5.00', bajoMinimo: false, activo: true };
const proveedores = [{ id: 1, ruc: '20601234567', razonSocial: 'Distribuidora Odontomed S.A.C.', contacto: null, telefono: null, email: null, activo: true }];
const pedido = {
  id: 3, codigo: 'PED-0003', estado: 'pendiente', fecha: '2026-11-03T15:00:00Z', recibidoEn: null, motivoAnulacion: null, observacionRecepcion: null, registradoPor: 'Carlos Vega',
  proveedor: { id: 1, ruc: '20601234567', razonSocial: 'Distribuidora Odontomed S.A.C.', email: null },
  detalles: [
    { id: 10, insumoId: 1, insumo: 'Resina compuesta A2', unidad: 'jeringa', stockActual: '4.00', cantidadPedida: '10.00', cantidadRecibida: null },
    { id: 11, insumoId: 3, insumo: 'Guantes de nitrilo M', unidad: 'par', stockActual: '6.00', cantidadPedida: '50.00', cantidadRecibida: null },
  ],
};

describe('CU-30 NuevoPedido', () => {
  it('1.1: desde alertas precarga los insumos en stock mínimo con cantidad sugerida', async () => {
    simularApi({ 'GET /proveedores': { body: proveedores }, 'GET /insumos': { body: [resina, copa] } });
    renderizar(<Routes><Route path="/pedidos/nuevo" element={<NuevoPedido />} /></Routes>, '/pedidos/nuevo?alertas=1');
    expect(await screen.findByLabelText('Cantidad de Resina compuesta A2')).toHaveValue('6'); // 5×2 − 4
    expect(screen.queryByLabelText('Cantidad de Copa de goma')).not.toBeInTheDocument();
  });

  it('flujo básico: busca insumo (CU-22), agrega, elige proveedor y registra', async () => {
    const llamadas = simularApi({
      'GET /proveedores': { body: proveedores },
      'GET /insumos': { body: [resina, copa] },
      'POST /pedidos': { status: 201, body: { ...pedido, codigo: 'PED-0004', detalles: [pedido.detalles[0]] } },
    });
    renderizar(<NuevoPedido />);
    const u = userEvent.setup();
    await screen.findByRole('option', { name: /Odontomed/ });
    await u.selectOptions(screen.getByLabelText('Proveedor'), '1');
    await u.type(screen.getByLabelText('Agregar insumo'), 'copa');
    await u.click(await screen.findByRole('option', { name: /Copa de goma/ }));
    const cant = screen.getByLabelText('Cantidad de Copa de goma');
    await u.clear(cant);
    await u.type(cant, '20');
    await u.click(screen.getByRole('button', { name: 'Registrar pedido' }));
    expect(await screen.findByText('Pedido PED-0004 registrado')).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ proveedorId: 1, insumos: [{ insumoId: 4, cantidad: 20 }] });
  });

  it('8.1: sin insumos ni proveedor → mensajes y no envía', async () => {
    const llamadas = simularApi({ 'GET /proveedores': { body: proveedores } });
    renderizar(<NuevoPedido />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar pedido' }));
    expect(screen.getByText(MENSAJES.SIN_INSUMOS_PEDIDO)).toBeInTheDocument();
    expect(screen.getByText('Elija un proveedor')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });
});

const recepcion = () => renderizar(<Routes><Route path="/pedidos/:id/recepcion" element={<RecepcionPedido />} /></Routes>, '/pedidos/3/recepcion');

describe('CU-33 RecepcionPedido', () => {
  it('flujo básico: por defecto lo recibido = lo pedido; exige marcar «verifiqué»', async () => {
    const llamadas = simularApi({ 'GET /pedidos/3': { body: pedido }, 'POST /pedidos/3/recepcion': { body: { ...pedido, estado: 'recibido' } } });
    recepcion();
    const u = userEvent.setup();
    expect(await screen.findByLabelText('Recibido de Resina compuesta A2')).toHaveValue('10');
    await u.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    expect(screen.getByText(MENSAJES.VERIFICACION_REQUERIDA)).toBeInTheDocument();
    await u.click(screen.getByLabelText('Verifiqué lo recibido contra el pedido'));
    await u.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    expect(await screen.findByText('Recepción del pedido PED-0003 registrada')).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ verificado: true, items: [{ detalleId: 10, cantidadRecibida: 10 }, { detalleId: 11, cantidadRecibida: 50 }] });
  });

  it('6.1: con diferencias resalta la fila y exige observación', async () => {
    const llamadas = simularApi({ 'GET /pedidos/3': { body: pedido }, 'POST /pedidos/3/recepcion': { body: { ...pedido, estado: 'recibido_con_diferencias' } } });
    recepcion();
    const u = userEvent.setup();
    const guantes = await screen.findByLabelText('Recibido de Guantes de nitrilo M');
    await u.clear(guantes);
    await u.type(guantes, '30');
    expect(guantes.closest('tr')).toHaveClass('table-warning');
    expect(screen.getByText(/Hay 1 diferencia\(s\)/)).toBeInTheDocument();
    await u.click(screen.getByLabelText('Verifiqué lo recibido contra el pedido'));
    await u.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    expect(screen.getByText(MENSAJES.OBSERVACION_REQUERIDA)).toBeInTheDocument();
    await u.type(screen.getByLabelText(/Observación/), 'Faltaron 20 pares');
    await u.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    await screen.findByText('Recepción del pedido PED-0003 registrada');
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toMatchObject({ observacion: 'Faltaron 20 pares', items: [{ detalleId: 10, cantidadRecibida: 10 }, { detalleId: 11, cantidadRecibida: 30 }] });
  });

  it('pedido que ya no está pendiente → aviso, sin formulario', async () => {
    simularApi({ 'GET /pedidos/3': { body: { ...pedido, estado: 'anulado' } } });
    recepcion();
    expect(await screen.findByText(MENSAJES.PEDIDO_NO_PENDIENTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar recepción' })).not.toBeInTheDocument();
  });
});

describe('CU-31/32 Pedidos', () => {
  it('2.1 (CU-33): sin pendientes muestra el mensaje', async () => {
    simularApi({ 'GET /pedidos': { body: { pedidos: [], mensaje: MENSAJES.SIN_PEDIDOS_PENDIENTES } } });
    renderizar(<Pedidos />);
    expect(await screen.findByText(MENSAJES.SIN_PEDIDOS_PENDIENTES)).toBeInTheDocument();
  });

  it('CU-32: anular exige motivo y llama a la API; «Enviar» deshabilitado si el proveedor no tiene correo', async () => {
    const llamadas = simularApi({ 'GET /pedidos': { body: { pedidos: [pedido] } }, 'PATCH /pedidos/3/anular': { body: { ...pedido, estado: 'anulado' } } });
    renderizar(<Pedidos />);
    const u = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Enviar al proveedor' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Anular' }));
    const modal = await screen.findByRole('dialog');
    await u.click(within(modal).getByRole('button', { name: 'Anular pedido' }));
    expect(within(modal).getByText('Indique el motivo de la anulación')).toBeInTheDocument();
    await u.type(within(modal).getByLabelText('Motivo de la anulación'), 'Proveedor sin stock');
    await u.click(within(modal).getByRole('button', { name: 'Anular pedido' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'PATCH')?.body).toEqual({ motivo: 'Proveedor sin stock' }));
  });
});

describe('CU-24 Alertas', () => {
  it('marca revisada y arma el enlace de pedido con los seleccionados', async () => {
    const alerta = { id: 9, fecha: '2026-11-03T15:00:00Z', stockAlGenerar: '4.00', revisada: false, revisadaPor: null, revisadaEn: null, insumo: resina };
    const llamadas = simularApi({ 'GET /alertas': { body: [alerta] }, 'PATCH /alertas/9/revisar': { body: { ...alerta, revisada: true } } });
    renderizar(<Alertas />);
    const u = userEvent.setup();
    await u.click(await screen.findByLabelText('Seleccionar Resina compuesta A2'));
    expect(screen.getByRole('link', { name: 'Pedir 1 seleccionado(s)' })).toHaveAttribute('href', '/pedidos/nuevo?insumos=1');
    await u.click(screen.getByRole('button', { name: 'Marcar revisada' }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PATCH' && l.url === '/api/alertas/9/revisar')).toBe(true));
  });
});

describe('CU-38 Panel y CU-39 Reportes', () => {
  it('panel: muestra indicadores e insumos en mínimo', async () => {
    simularApi({
      'GET /panel': {
        body: {
          fecha: '2026-11-03',
          citasHoy: { total: 3, porEstado: { confirmada: 2, atendida: 1 } },
          ingresos: { hoy: '200.00', comprobantesHoy: 2, mes: '1500.00', comprobantesMes: 12, ultimos7Dias: [{ fecha: '2026-11-03', total: '200.00' }] },
          inventario: { alertasPendientes: 1, alertas: [{ id: 1, insumo: 'Resina compuesta A2', unidad: 'jeringa', stockActual: '4.00', stockMinimo: '5.00' }], pedidosPendientes: 0 },
          agenda: { adelantosPorPagar: 4, inasistenciasMes: 1, pacientesRestringidos: 0 },
        },
      },
    });
    renderizar(<Panel />);
    expect(await screen.findByText('S/ 1,500.00')).toBeInTheDocument();
    expect(screen.getByText('4 adelanto(s) por pagar')).toBeInTheDocument();
    expect(screen.getByText('Resina compuesta A2')).toBeInTheDocument();
  });

  it('reportes: rango inválido avisa y no consulta; válido ofrece CSV', async () => {
    const llamadas = simularApi({
      'GET /reportes/ingresos': { body: { desde: '2026-11-01', hasta: '2026-11-03', resumen: { total: '280.00', comprobantes: 2, ticketPromedio: '140.00', descuentos: '0.00', adelantos: '0.00' }, porTipoPago: [], porDia: [], porTratamiento: [], detalle: [] } },
    });
    renderizar(<Reportes />);
    expect(await screen.findByText('S/ 280.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exportar CSV (Excel)' }).getAttribute('href')).toMatch(/^\/api\/reportes\/ingresos\?desde=.*&formato=csv$/);
    const n = llamadas.length;
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2030-01-01' } });
    expect(await screen.findByText('La fecha inicial debe ser anterior a la final')).toBeInTheDocument();
    expect(llamadas.length).toBe(n);
  });
});
