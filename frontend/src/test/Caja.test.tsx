import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENSAJES } from '@clinica/shared';
import Caja from '../pages/Caja';
import { renderizar, simularApi } from './utils';

const pendiente = { citaId: 7, tipo: 'servicio', fecha: '2026-11-03', hora: '10:00', odontologo: 'Dr. Luis Paredes', paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas' }, importe: '200.00' };
const importe = {
  citaId: 7, tipo: 'servicio', paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', email: 'maria@correo.local' },
  lineas: [{ tratamientoId: 1, descripcion: 'Curación con resina — pieza 16', precio: '120.00' }, { tratamientoId: 2, descripcion: 'Profilaxis', precio: '80.00' }],
  subtotal: '200.00', descuento: '0.00', descuentoAplicado: null, adelantoAplicado: '0.00', total: '200.00',
};
const tipos = [{ id: 1, nombre: 'Efectivo' }, { id: 2, nombre: 'Tarjeta' }, { id: 3, nombre: 'Yape/Plin' }];
const comprobante = {
  id: 1, numero: 'C-000001', tipo: 'servicio', citaId: 7, estadoCita: 'pagada', fecha: '2026-11-03T15:00:00Z',
  paciente: { dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', tieneCorreo: true }, tipoPago: 'Efectivo', descuento: null,
  lineas: importe.lineas, subtotal: '200.00', adelantoAplicado: '0.00', total: '200.00', montoRecibido: '250.00', vuelto: '50.00', enviadoEmail: false, emitidoPor: 'Ana Ríos',
};
const base = {
  'GET /caja/pendientes': { body: [pendiente] },
  'GET /caja/citas/7/importe': { body: importe },
  'GET /tipos-pago': { body: tipos },
  'GET /descuentos': { body: [{ id: 1, nombre: 'Paciente frecuente', porcentaje: '10.00' }] },
};

async function abrirCobro() {
  renderizar(<Caja />);
  const u = userEvent.setup();
  await u.click(await screen.findByRole('button', { name: /María Quispe Rojas/ }));
  await screen.findByText('Curación con resina — pieza 16');
  return u;
}

describe('CU-13 Caja', () => {
  it('flujo básico (efectivo): calcula vuelto, emite y ofrece imprimir y enviar', async () => {
    const llamadas = simularApi({ ...base, 'POST /caja/citas/7/comprobante': { status: 201, body: comprobante } });
    const u = await abrirCobro();
    expect(screen.getByTestId('total')).toHaveTextContent('S/ 200.00');
    await u.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await u.type(screen.getByLabelText('Monto recibido (S/)'), '250');
    expect(screen.getByTestId('vuelto')).toHaveTextContent('S/ 50.00');
    await u.click(screen.getByRole('button', { name: 'Emitir comprobante por S/ 200.00' }));
    expect(await screen.findByText('Comprobante C-000001 emitido')).toBeInTheDocument();
    expect(screen.getByText('S/ 50.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar por correo' })).toBeEnabled();
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ tipoPagoId: 1, montoRecibido: 250, descuentoId: null });
  });

  it('6.1: monto insuficiente → mensaje y no emite', async () => {
    const llamadas = simularApi(base);
    const u = await abrirCobro();
    await u.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await u.type(screen.getByLabelText('Monto recibido (S/)'), '150');
    await u.click(screen.getByRole('button', { name: /Emitir comprobante/ }));
    expect(screen.getByText(MENSAJES.MONTO_INSUFICIENTE)).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });

  it('sin tipo de pago no emite', async () => {
    simularApi(base);
    const u = await abrirCobro();
    await u.click(screen.getByRole('button', { name: /Emitir comprobante/ }));
    expect(screen.getByText('Elija un tipo de pago')).toBeInTheDocument();
  });

  it('tarjeta: no pide monto y envía sin montoRecibido', async () => {
    const llamadas = simularApi({ ...base, 'POST /caja/citas/7/comprobante': { status: 201, body: { ...comprobante, tipoPago: 'Tarjeta', vuelto: '0.00' } } });
    const u = await abrirCobro();
    await u.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    expect(screen.queryByLabelText('Monto recibido (S/)')).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Emitir comprobante/ }));
    await screen.findByText('Comprobante C-000001 emitido');
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ tipoPagoId: 2, descuentoId: null });
  });

  it('P3: al elegir un descuento se recalcula el importe en el servidor', async () => {
    const llamadas = simularApi({
      ...base,
      'GET /caja/citas/7/importe': [{ body: importe }, { body: { ...importe, descuento: '20.00', descuentoAplicado: { id: 1, nombre: 'Paciente frecuente', porcentaje: '10.00' }, total: '180.00' } }],
    });
    const u = await abrirCobro();
    await u.selectOptions(await screen.findByLabelText('Descuento'), '1');
    expect(await screen.findByText('− S/ 20.00')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('S/ 180.00');
    expect(llamadas.some((l) => l.url === '/api/caja/citas/7/importe?descuentoId=1')).toBe(true);
  });

  it('3.1: adelanto → aviso RN-12 y sin selector de descuento', async () => {
    simularApi({
      ...base,
      'GET /caja/pendientes': { body: [{ ...pendiente, tipo: 'adelanto', importe: '30.00' }] },
      'GET /caja/citas/7/importe': { body: { ...importe, tipo: 'adelanto', lineas: [{ tratamientoId: null, descripcion: 'Adelanto de reserva', precio: '30.00' }], subtotal: '30.00', total: '30.00' } },
    });
    renderizar(<Caja />);
    const u = userEvent.setup();
    const item = await screen.findByRole('button', { name: /María Quispe Rojas/ });
    expect(within(item).getByText('Adelanto')).toBeInTheDocument();
    await u.click(item);
    expect(await screen.findByText('Cobro de adelanto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Descuento')).not.toBeInTheDocument();
  });

  it('4.1: tratamiento sin precio → muestra el error del servidor', async () => {
    simularApi({ ...base, 'GET /caja/citas/7/importe': { status: 422, body: { codigo: 'TRATAMIENTO_SIN_PRECIO', mensaje: MENSAJES.TRATAMIENTO_SIN_PRECIO } } });
    renderizar(<Caja />);
    await userEvent.click(await screen.findByRole('button', { name: /María Quispe Rojas/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES.TRATAMIENTO_SIN_PRECIO);
  });

  it('9.1: paciente sin correo → «Enviar» deshabilitado', async () => {
    simularApi({ ...base, 'POST /caja/citas/7/comprobante': { status: 201, body: { ...comprobante, paciente: { ...comprobante.paciente, tieneCorreo: false } } } });
    const u = await abrirCobro();
    await u.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await u.click(screen.getByRole('button', { name: /Emitir comprobante/ }));
    expect(await screen.findByRole('button', { name: 'Enviar por correo' })).toBeDisabled();
  });

  it('10.1: si falla la impresión, avisa que el comprobante ya quedó registrado y permite reintentar', async () => {
    simularApi({ ...base, 'POST /caja/citas/7/comprobante': { status: 201, body: comprobante }, 'GET /comprobantes/1/pdf': { status: 500, body: {} } });
    const u = await abrirCobro();
    await u.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await u.click(screen.getByRole('button', { name: /Emitir comprobante/ }));
    await u.click(await screen.findByRole('button', { name: 'Imprimir (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES.ERROR_PDF);
    expect(screen.getByRole('button', { name: 'Reintentar impresión' })).toBeInTheDocument();
  });

  it('imprimir: abre el PDF en una pestaña nueva', async () => {
    simularApi({ ...base, 'POST /caja/citas/7/comprobante': { status: 201, body: comprobante }, 'GET /comprobantes/1/pdf': { body: {} } });
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const u = await abrirCobro();
    await u.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    await u.click(screen.getByRole('button', { name: /Emitir comprobante/ }));
    await u.click(await screen.findByRole('button', { name: 'Imprimir (PDF)' }));
    await vi.waitFor(() => expect(abrir).toHaveBeenCalledWith('blob:x', '_blank', 'noopener'));
  });
});
