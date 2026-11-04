import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENSAJES } from '@clinica/shared';
import Caja from '../pages/Caja';
import { renderizar, simularApi } from './utils';

const pendiente = { citaId: 7, tipo: 'servicio', estado: 'atendida', saldoFavor: '0.00', tratamientoPrevisto: null, adelantoVenceEn: null, pagoReportado: null, fecha: '2026-11-03', hora: '10:00', odontologo: 'Dr. Luis Paredes', paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas' }, importe: '200.00' };
const importe = {
  citaId: 7, tipo: 'servicio', paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', email: 'maria@correo.local' },
  lineas: [{ tratamientoId: 1, descripcion: 'Curación con resina — pieza 16', precio: '120.00', descuento: '0.00', campana: null }, { tratamientoId: 2, descripcion: 'Profilaxis', precio: '80.00', descuento: '0.00', campana: null }],
  subtotal: '200.00', descuento: '0.00', adelantoAplicado: '0.00', saldoAplicado: '0.00', sobrante: '0.00', total: '200.00', pagoReportado: null,
};
const tipos = [{ id: 1, nombre: 'Efectivo' }, { id: 2, nombre: 'Tarjeta' }, { id: 3, nombre: 'Yape/Plin' }];
const comprobante = {
  id: 1, numero: 'C-000001', tipo: 'servicio', citaId: 7, estadoCita: 'pagada', fecha: '2026-11-03T15:00:00Z',
  paciente: { dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', tieneCorreo: true, saldoFavor: '0.00' }, tipoPago: 'Efectivo', operacion: null, descuento: '0.00',
  lineas: importe.lineas, subtotal: '200.00', adelantoAplicado: '0.00', saldoAplicado: '0.00', saldoGenerado: '0.00', total: '200.00', montoRecibido: '250.00', vuelto: '50.00', enviadoEmail: false, emitidoPor: 'Ana Ríos',
};
const base = {
  'GET /caja/pendientes': { body: [pendiente] },
  'GET /caja/citas/7/importe': { body: importe },
  'GET /tipos-pago': { body: tipos },
  'GET /caja/campanas': { body: [] },
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
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ tipoPagoId: 1, montoRecibido: 250 });
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
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ tipoPagoId: 2 });
  });

  it('campañas: muestra el descuento de cada línea, el saldo a favor y lo que queda como saldo', async () => {
    simularApi({
      ...base,
      'GET /caja/campanas': { body: [{ id: 1, nombre: 'Fiestas Patrias — limpieza', tipo: 'porcentaje', porcentaje: '20.00', hasta: '2026-07-31', edadMaxima: null, tratamientos: ['Profilaxis'] }] },
      'GET /caja/citas/7/importe': {
        body: { ...importe, lineas: [importe.lineas[0], { ...importe.lineas[1], descuento: '16.00', campana: 'Fiestas Patrias — limpieza' }], descuento: '16.00', saldoAplicado: '50.00', total: '134.00' },
      },
    });
    await abrirCobro();
    expect(screen.getByText(/Campañas vigentes hoy/)).toHaveTextContent('Fiestas Patrias — limpieza (20 %)');
    expect(screen.getByText('Fiestas Patrias — limpieza: − S/ 16.00')).toBeInTheDocument();
    expect(screen.getByText('Saldo a favor')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('S/ 134.00');
  });

  it('pago reportado por Yape: muestra la operación y al aprobar emite el comprobante', async () => {
    const reportado = { metodo: 'yape', numeroOperacion: '12345678', reportadoEn: '2026-11-04T15:00:00Z', tieneCaptura: true };
    const llamadas = simularApi({
      ...base,
      'GET /caja/pendientes': { body: [{ ...pendiente, tipo: 'adelanto', estado: 'pago_en_verificacion', importe: '40.00', pagoReportado: { metodo: 'yape', numeroOperacion: '12345678' } }] },
      'GET /caja/citas/7/importe': { body: { ...importe, tipo: 'adelanto', lineas: [{ tratamientoId: null, descripcion: 'Adelanto 50 % (Extracción simple)', precio: '40.00', descuento: '0.00', campana: null }], subtotal: '40.00', total: '40.00', pagoReportado: reportado } },
      'POST /caja/citas/7/aprobar-pago': { status: 201, body: { ...comprobante, tipo: 'adelanto', total: '40.00', vuelto: '0.00', tipoPago: 'Yape/Plin', operacion: '12345678', estadoCita: 'confirmada' } },
    });
    renderizar(<Caja />);
    const u = userEvent.setup();
    const item = await screen.findByRole('button', { name: /María Quispe Rojas/ });
    expect(within(item).getByText('Verificar Yape')).toBeInTheDocument();
    await u.click(item);
    expect(await screen.findByText('Verificar pago de adelanto')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver captura' })).toHaveAttribute('href', '/api/caja/citas/7/captura');
    expect(screen.queryByRole('radiogroup', { name: 'Tipo de pago' })).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Aprobar pago y emitir comprobante' }));
    expect(await screen.findByText(/Yape\/Plin \(op\. 12345678\)/)).toBeInTheDocument();
    expect(screen.getByText('La cita quedó «Confirmada».')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url === '/api/caja/citas/7/aprobar-pago')).toBe(true);
  });

  it('rechazar un pago reportado exige motivo', async () => {
    const llamadas = simularApi({
      ...base,
      'GET /caja/pendientes': { body: [{ ...pendiente, tipo: 'adelanto', estado: 'pago_en_verificacion', importe: '20.00', pagoReportado: { metodo: 'plin', numeroOperacion: '999' } }] },
      'GET /caja/citas/7/importe': { body: { ...importe, tipo: 'adelanto', lineas: [], subtotal: '20.00', total: '20.00', pagoReportado: { metodo: 'plin', numeroOperacion: '999', reportadoEn: '2026-11-04T15:00:00Z', tieneCaptura: false } } },
      'POST /caja/citas/7/rechazar-pago': { body: { citaId: 7, estado: 'liberada' } },
    });
    renderizar(<Caja />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /María Quispe Rojas/ }));
    await u.click(await screen.findByRole('button', { name: 'Rechazar' }));
    const modal = await screen.findByRole('dialog');
    await u.click(within(modal).getByRole('button', { name: 'Rechazar y liberar el horario' }));
    expect(within(modal).getByText('Indique el motivo del rechazo')).toBeInTheDocument();
    await u.type(within(modal).getByLabelText(/Motivo/), 'No llegó el pago');
    await u.click(within(modal).getByRole('button', { name: 'Rechazar y liberar el horario' }));
    await waitFor(() => expect(llamadas.find((l) => l.url === '/api/caja/citas/7/rechazar-pago')?.body).toEqual({ motivo: 'No llegó el pago' }));
  });

  it('3.1: adelanto en la clínica → aviso de confirmación al pagar', async () => {
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
    expect(screen.getByText(/Al pagarlo la cita queda confirmada/)).toBeInTheDocument();
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
