// Horario del odontólogo, fecha angosta, aviso de Insumos, reabrir alertas, campos numéricos, RUC (SUNAT) y saldo a favor
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormReserva } from '../components/FormReserva';
import { PanelPagoAdelanto } from '../components/PanelPagoAdelanto';
import { FormProveedor } from '../pages/Proveedores';
import Insumos from '../pages/Insumos';
import Alertas from '../pages/Alertas';
import MiPerfil from '../pages/MiPerfil';
import { FormPaciente } from '../components/FormPaciente';
import { renderizar, simularApi } from './utils';
import type { Cita } from '../api/recursos';

const odontologos = [
  { id: 1, nombres: 'Dr. Luis Paredes', especialidad: 'Odontología general', horario: { corto: 'Lunes–Viernes 08:00–14:00', largo: 'lunes a viernes, de 08:00 a 14:00' } },
  { id: 2, nombres: 'Dra. Carmen Díaz', especialidad: 'Endodoncia', horario: { corto: 'Lunes–Sábado 14:00–20:00', largo: 'lunes a sábado, de 14:00 a 20:00' } },
];

describe('Reserva: horario del odontólogo y fecha', () => {
  it('la lista muestra el horario de cada uno y, al elegir, la ayuda lo dice completo', async () => {
    simularApi({ 'GET /odontologos': { body: odontologos }, 'GET /tarifario': { body: [{ id: 5, nombre: 'Consulta', precio: '40.00' }] } });
    renderizar(<FormReserva />);
    const u = userEvent.setup();
    expect(await screen.findByRole('option', { name: 'Dr. Luis Paredes — Odontología general · Lunes–Viernes 08:00–14:00' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dra. Carmen Díaz — Endodoncia · Lunes–Sábado 14:00–20:00' })).toBeInTheDocument();
    expect(screen.queryByTestId('horario-odontologo')).toBeNull();
    await u.selectOptions(screen.getByLabelText('Odontólogo'), '2');
    expect(screen.getByTestId('horario-odontologo')).toHaveTextContent('Atiende de lunes a sábado, de 14:00 a 20:00');
    expect(screen.getByLabelText('Fecha')).toHaveStyle({ width: '180px' });
    expect(screen.getByText(/Para reservar se paga un adelanto del 50 %/)).toBeInTheDocument();
  });
});

describe('Adelanto con saldo a favor', () => {
  const cita: Cita = {
    id: 5, pacienteId: 1, odontologoId: 1, odontologo: 'Dr. Luis Paredes', fecha: '2030-01-07', hora: '10:00', motivo: 'Dolor', canal: 'web',
    estado: 'pendiente_adelanto', tratamientoPrevisto: 'Consulta', montoAdelanto: '20.00', adelantoVenceEn: new Date(Date.now() + 50 * 60_000).toISOString(),
    adelantoPagado: null, pagoReportado: null, pagoRechazoMotivo: null, saldoAplicable: '15.00', aPagar: '5.00',
  };
  it('muestra cuánto cubre el saldo y pide solo la diferencia; indica la vigencia del saldo', async () => {
    simularApi({ 'GET /datos-pago': { body: { numero: '987799567', titular: 'Clínica Dental', billeteras: ['yape'], tieneQr: false, saldoVigenciaMeses: 12 } } });
    renderizar(<PanelPagoAdelanto cita={cita} modo="web" />);
    expect(screen.getByRole('status')).toHaveTextContent('Su saldo a favor cubre S/ 15.00: solo debe pagar S/ 5.00.');
    expect(await screen.findByText(/el monto de/)).toHaveTextContent('el monto de S/ 5.00');
    expect(await screen.findByText(/queda como saldo a favor por 12 meses/)).toBeInTheDocument();
  });

  it('Mis datos muestra el saldo y cuándo vence', async () => {
    simularApi({
      'GET /pacientes/me': { body: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '949123456', email: null, inasistencias: 0, restringido: false, saldoFavor: '30.00', saldoVencimientos: [{ monto: '30.00', venceEn: '2027-11-05T15:00:00.000Z' }] } },
    });
    renderizar(<MiPerfil />);
    expect(await screen.findByText(/S\/ 30.00 vencen el 05\/11\/2027/)).toBeInTheDocument();
  });
});

describe('Insumos y alertas', () => {
  const insumo = (id: number, nombre: string, stock: string, minimo: string) => ({ id, nombre, unidad: 'unidad', stockActual: stock, stockMinimo: minimo, bajoMinimo: Number(stock) <= Number(minimo), activo: true });
  const bajos = [insumo(1, 'Copa de goma', '4', '5'), insumo(2, 'Guantes de nitrilo M', '7', '10'), insumo(3, 'Resina compuesta A2', '5', '5')];
  const alerta = (id: number, i: ReturnType<typeof insumo>, revisada: boolean) => ({ id, fecha: '2026-11-04T19:44:00Z', stockAlGenerar: i.stockActual, revisada, revisadaPor: revisada ? 'Carlos Vega' : null, revisadaEn: revisada ? '2026-11-04T19:51:00Z' : null, insumo: i });

  it('el aviso cuenta todos los insumos en el mínimo (como la tabla) y aparte las alertas sin revisar; hay leyenda del color', async () => {
    simularApi({ 'GET /insumos': { body: bajos }, 'GET /alertas': { body: [alerta(1, bajos[0], false)] } });
    renderizar(<Insumos />);
    const aviso = await screen.findByText(/3 insumo\(s\) en stock mínimo/);
    expect(aviso.closest('.alert')).toHaveTextContent('Copa de goma, Guantes de nitrilo M, Resina compuesta A2');
    expect(aviso.closest('.alert')).toHaveTextContent('1 alerta(s) sin revisar');
    expect(screen.getByText(/Fila naranja = stock igual o menor al mínimo/)).toBeInTheDocument();
  });

  it('una alerta revisada por error se puede volver a pendiente', async () => {
    const llamadas = simularApi({ 'GET /alertas': { body: [alerta(7, bajos[0], true)] }, 'PATCH /alertas/7/reabrir': { body: alerta(7, bajos[0], false) } });
    renderizar(<Alertas />);
    const u = userEvent.setup();
    await u.click(screen.getByLabelText('Mostrar también las revisadas'));
    const tarjeta = (await screen.findByText(/Revisada por Carlos Vega/)).closest('.tarjeta') as HTMLElement;
    expect(within(tarjeta).getByRole('link', { name: 'Pedir' })).toHaveAttribute('href', '/pedidos/nuevo?insumos=1');
    await u.click(within(tarjeta).getByRole('button', { name: 'Volver a pendiente' }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PATCH' && l.url.endsWith('/alertas/7/reabrir'))).toBe(true));
  });
});

describe('Campos numéricos y RUC', () => {
  it('RUC: solo dígitos, máximo 11; al completarlo trae la razón social y avisa si no está activo', async () => {
    const llamadas = simularApi({ 'GET /sunat/20481234567': { body: { encontrado: true, razonSocial: 'DENTAL NORTE S.A.C.', direccion: null, estado: 'BAJA DE OFICIO', condicion: 'HABIDO', aviso: 'Este RUC figura como BAJA DE OFICIO en SUNAT' } } });
    renderizar(<FormProveedor proveedor={null} onCerrar={() => undefined} />);
    const u = userEvent.setup();
    const ruc = screen.getByLabelText('RUC');
    await u.type(ruc, 'ab20-481 234 5678 999');
    expect(ruc).toHaveValue('20481234567');
    await waitFor(() => expect(screen.getByLabelText('Razón social')).toHaveValue('DENTAL NORTE S.A.C.'));
    expect(screen.getByText('⚠ Este RUC figura como BAJA DE OFICIO en SUNAT')).toBeInTheDocument();
    expect(llamadas.filter((l) => l.url.includes('/sunat/')).length).toBe(1);
    const tel = screen.getByLabelText('Teléfono (opcional)');
    await u.type(tel, '9877-99567x1');
    expect(tel).toHaveValue('987799567');
  });

  it('DNI (8) y celular (9) del paciente: solo dígitos', async () => {
    simularApi({});
    renderizar(<FormPaciente textoBoton="Registrar" onEnviar={async () => undefined} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI'), '72.458.190-9');
    expect(screen.getByLabelText('DNI')).toHaveValue('72458190');
    await u.type(screen.getByLabelText('Celular'), '+51 949 123 456');
    expect(screen.getByLabelText('Celular')).toHaveValue('519491234');
  });
});
