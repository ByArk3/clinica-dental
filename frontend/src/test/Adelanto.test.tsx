import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENSAJES } from '@clinica/shared';
import { PanelPagoAdelanto } from '../components/PanelPagoAdelanto';
import { FormReserva } from '../components/FormReserva';
import { renderizar, simularApi } from './utils';
import type { Cita } from '../api/recursos';

const cita: Cita = {
  id: 5, pacienteId: 1, odontologoId: 1, odontologo: 'Dr. Luis Paredes', fecha: '2030-01-07', hora: '10:00', motivo: 'Dolor', canal: 'web',
  estado: 'pendiente_adelanto', tratamientoPrevisto: 'Extracción simple', montoAdelanto: '40.00',
  adelantoVenceEn: new Date(Date.now() + 50 * 60_000).toISOString(), adelantoPagado: null, pagoReportado: null, pagoRechazoMotivo: null,
};
const datosPago = { body: { numero: '987654321', titular: 'Clínica Dental (ficticio)', billeteras: ['yape', 'plin'], tieneQr: false } };
const soloYape = { body: { numero: '987799567', titular: 'Clínica Dental', billeteras: ['yape'], tieneQr: true } };

describe('Adelanto: panel de pago', () => {
  it('web: muestra monto, plazo y datos de Yape; registra el N.° de operación', async () => {
    const llamadas = simularApi({ 'GET /datos-pago': datosPago, 'POST /citas/5/pago': { body: { ...cita, estado: 'pago_en_verificacion', pagoReportado: { metodo: 'plin', numeroOperacion: 'BCP445566778', reportadoEn: '2030-01-01T00:00:00Z' } } } });
    renderizar(<PanelPagoAdelanto cita={cita} modo="web" />);
    const u = userEvent.setup();
    expect(screen.getByText('Adelanto: S/ 40.00')).toBeInTheDocument();
    expect(screen.getByText(/quedan (49|50) min/)).toBeInTheDocument();
    expect(await screen.findByText('987654321')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Ya pagué: registrar mi pago' }));
    expect(screen.getByText('Ingrese el número de operación que le dio la aplicación')).toBeInTheDocument();
    await u.click(screen.getByRole('radio', { name: 'Plin' }));
    expect(screen.getByText(/Letras y números, de 12 a 20/)).toBeInTheDocument();
    await u.type(screen.getByLabelText('Número de operación'), 'bcp-1');
    expect(screen.getByLabelText('Número de operación')).toHaveValue('BCP1'); // sin símbolos y en mayúsculas
    await u.click(screen.getByRole('button', { name: 'Ya pagué: registrar mi pago' }));
    expect(screen.getByText('El código de operación de Plin tiene de 12 a 20 caracteres')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Número de operación'), '45566778');
    await u.click(screen.getByRole('button', { name: 'Ya pagué: registrar mi pago' }));
    // confirmación con resumen antes de enviar
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('¿Ya realizó el pago?')).toBeInTheDocument();
    expect(within(modal).getByText('BCP145566778')).toBeInTheDocument();
    expect(within(modal).getByText('Sin captura')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
    await u.click(within(modal).getByRole('button', { name: 'Volver y revisar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await u.clear(screen.getByLabelText('Número de operación'));
    await u.type(screen.getByLabelText('Número de operación'), 'BCP445566778');
    await u.click(screen.getByRole('button', { name: 'Ya pagué: registrar mi pago' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, ya pagué' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ metodo: 'plin', numeroOperacion: 'BCP445566778' }));
  });

  it('solo Yape: no pregunta la billetera, muestra el QR y envía «yape»', async () => {
    const llamadas = simularApi({ 'GET /datos-pago': soloYape, 'POST /citas/5/pago': { body: { ...cita, estado: 'pago_en_verificacion' } } });
    renderizar(<PanelPagoAdelanto cita={cita} modo="web" />);
    const u = userEvent.setup();
    expect(await screen.findByRole('img', { name: 'QR de Yape de la clínica' })).toHaveAttribute('src', '/api/datos-pago/qr');
    // tocar el QR lo amplía
    expect(screen.getByText('🔍 Toca el QR para ampliarlo')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Ampliar el QR' }));
    expect(await screen.findByRole('img', { name: 'QR de Yape de la clínica (ampliado)' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('img', { name: /ampliado/ })).toBeNull());
    expect(screen.getByText(/Escanee el QR con Yape o pague al/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    // Yape: solo números y máximo 8 (no deja escribir más ni letras)
    await u.type(screen.getByLabelText('Número de operación'), '7788a99112233');
    expect(screen.getByLabelText('Número de operación')).toHaveValue('77889911');
    await u.clear(screen.getByLabelText('Número de operación'));
    await u.type(screen.getByLabelText('Número de operación'), '778899');
    await u.click(screen.getByRole('button', { name: 'Ya pagué: registrar mi pago' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, ya pagué' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ metodo: 'yape', numeroOperacion: '778899' }));
  });

  it('web: rechaza una captura que no es imagen', async () => {
    simularApi({ 'GET /datos-pago': datosPago });
    renderizar(<PanelPagoAdelanto cita={cita} modo="web" />);
    const u = userEvent.setup({ applyAccept: false });
    await u.upload(screen.getByLabelText(/Captura del pago/), new File(['hola'], 'nota.txt', { type: 'text/plain' }));
    expect(await screen.findByText('La captura debe ser una imagen PNG, JPG o WEBP')).toBeInTheDocument();
  });

  it('presencial: lleva a Caja para cobrarlo en el momento', () => {
    simularApi({ 'GET /datos-pago': datosPago });
    renderizar(<PanelPagoAdelanto cita={cita} modo="presencial" />);
    expect(screen.getByRole('link', { name: 'Cobrar ahora en Caja' })).toHaveAttribute('href', '/caja');
  });

  it('pago en verificación: muestra el estado del reporte', () => {
    simularApi({ 'GET /datos-pago': datosPago });
    renderizar(<PanelPagoAdelanto cita={{ ...cita, estado: 'pago_en_verificacion', pagoReportado: { metodo: 'yape', numeroOperacion: '123', reportadoEn: '2030-01-01T00:00:00Z' } }} modo="web" />);
    expect(screen.getByRole('status')).toHaveTextContent('Recibimos su reporte de pago (Yape, operación 123)');
  });
});

describe('FormReserva con tratamiento previsto', () => {
  it('envía el tratamiento elegido y, si requiere adelanto, muestra el panel de pago', async () => {
    const llamadas = simularApi({
      'GET /odontologos': { body: [{ id: 1, nombres: 'Dr. Luis Paredes', especialidad: null }] },
      'GET /tarifario': { body: [{ id: 5, nombre: 'Consulta', precio: '40.00' }, { id: 6, nombre: 'Extracción simple', precio: '80.00' }] },
      'GET /disponibilidad': { body: { fecha: '2030-01-07', atiende: true, horarios: ['10:00'] } },
      'GET /datos-pago': datosPago,
      'POST /citas': { status: 201, body: { cita, aviso: MENSAJES.ADELANTO_OBLIGATORIO, pago: datosPago.body } },
    });
    renderizar(<FormReserva />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/^Motivo/), 'Dolor');
    await screen.findByRole('option', { name: 'Extracción simple — S/ 80.00' });
    // la consulta es la opción por defecto, con su precio y una ayuda
    expect(screen.getByRole('option', { name: 'Consulta de evaluación — S/ 40.00' })).toBeInTheDocument();
    expect(screen.getByText('¿No sabe qué necesita? Elija la consulta: el odontólogo lo evaluará y le indicará el tratamiento.')).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Tratamiento previsto'), '6');
    await u.selectOptions(screen.getByLabelText('Odontólogo'), '1');
    await u.type(screen.getByLabelText('Fecha'), '2030-01-07');
    await u.click(await screen.findByRole('button', { name: '10:00' }));
    await u.click(screen.getByRole('button', { name: 'Reservar a las 10:00' }));
    await u.click(await screen.findByRole('button', { name: 'Sí' }));
    expect(await screen.findByText(MENSAJES.ADELANTO_OBLIGATORIO)).toBeInTheDocument();
    expect(screen.getByTestId('panel-adelanto')).toHaveTextContent('Adelanto: S/ 40.00');
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toMatchObject({ tratamientoPrevistoId: 6 });
  });
});

describe('CitasDelDia: cancelar una cita con adelanto pagado', () => {
  it('permite marcar que cancela la clínica y avisa que se devuelve', async () => {
    const { default: CitasDelDia } = await import('../pages/CitasDelDia');
    const { within } = await import('@testing-library/react');
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(Date.now() + 2 * 86_400_000));
    const fila = {
      ...cita, fecha: hoy, hora: '19:30', estado: 'confirmada', adelantoPagado: '40.00', canal: 'presencial',
      paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', telefono: '949123456', inasistencias: 3, restringido: true },
      puedeRegistrarInasistencia: false,
    };
    const llamadas = simularApi({
      'GET /citas': { body: [fila] },
      'PATCH /citas/5/cancelar': { body: { ...fila, estado: 'cancelada', adelanto: { monto: '40.00', resultado: 'devuelto' } } },
    });
    renderizar(<CitasDelDia />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Cancelar' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/Pagó un adelanto de/)).toHaveTextContent('S/ 40.00');
    await u.click(within(modal).getByLabelText('La cancela la clínica (se devuelve el adelanto)'));
    await u.click(within(modal).getByRole('button', { name: 'Sí, cancelar' }));
    expect(await screen.findByText(/debe devolverse al paciente/)).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'PATCH')?.body).toEqual({ porClinica: true });
  });
});
