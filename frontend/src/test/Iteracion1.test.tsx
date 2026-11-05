import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { MENSAJES } from '@clinica/shared';
import ConfirmarCita from '../pages/ConfirmarCita';
import CitasDelDia from '../pages/CitasDelDia';
import { MisCitas } from '../pages/ReservaWeb';
import { renderizar, simularApi } from './utils';

const enDias = (d: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(Date.now() + d * 86_400_000));
/** Fecha y hora (Lima) dentro de `h` horas */
const enHoras = (h: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(Date.now() + h * 3_600_000))
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
};

const confirmacion = { paciente: 'María', odontologo: 'Dr. Luis Paredes', fecha: '2030-01-07', hora: '10:00', estado: 'pendiente_confirmacion', puedeResponder: true };
const conToken = (ui: React.ReactNode) =>
  renderizar(<Routes><Route path="/citas/confirmar/:token" element={ui} /></Routes>, '/citas/confirmar/abc123');

describe('CU-08 ConfirmarCita', () => {
  it('flujo básico: muestra la cita y la confirma', async () => {
    const llamadas = simularApi({
      'GET /citas/recordatorio/abc123': { body: confirmacion },
      'POST /citas/recordatorio/abc123': { body: { ...confirmacion, estado: 'confirmada' } },
    });
    conToken(<ConfirmarCita />);
    expect(await screen.findByText(/07\/01\/2030 a las 10:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar asistencia' }));
    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
    expect(screen.getByText('¡Gracias! Lo esperamos.')).toBeInTheDocument();
    expect(llamadas.at(-1)?.body).toEqual({ accion: 'confirmar' });
  });

  it('alterno 4.1: cancelar desde el enlace', async () => {
    const llamadas = simularApi({
      'GET /citas/recordatorio/abc123': { body: confirmacion },
      'POST /citas/recordatorio/abc123': { body: { ...confirmacion, estado: 'cancelada', puedeResponder: false, mensaje: MENSAJES.CITA_YA_CANCELADA } },
    });
    conToken(<ConfirmarCita />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar cita' }));
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar asistencia' })).not.toBeInTheDocument();
    expect(llamadas.at(-1)?.body).toEqual({ accion: 'cancelar' });
  });

  it('alterno 2.2: plazo vencido → mensaje y sin botones', async () => {
    simularApi({ 'GET /citas/recordatorio/abc123': { body: { ...confirmacion, estado: 'liberada', puedeResponder: false, mensaje: MENSAJES.PLAZO_VENCIDO } } });
    conToken(<ConfirmarCita />);
    expect(await screen.findByText(MENSAJES.PLAZO_VENCIDO)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('enlace inválido → mensaje de error', async () => {
    simularApi({ 'GET /citas/recordatorio/abc123': { status: 404, body: { codigo: 'ENLACE_CITA_INVALIDO', mensaje: MENSAJES.ENLACE_CITA_INVALIDO } } });
    conToken(<ConfirmarCita />);
    expect(await screen.findByText(MENSAJES.ENLACE_CITA_INVALIDO)).toBeInTheDocument();
  });
});

const paciente = { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', telefono: '949123456', inasistencias: 2, restringido: false };
const base = { pacienteId: 1, odontologoId: 1, odontologo: 'Dr. Luis Paredes', motivo: 'Control', canal: 'presencial', paciente };

describe('CU-09 CitasDelDia', () => {
  it('3.1: inasistencia deshabilitada si la hora no pasó; habilitada si pasó', async () => {
    simularApi({
      'GET /citas': {
        body: [
          { ...base, id: 1, fecha: enDias(0), hora: '08:00', estado: 'confirmada', puedeRegistrarInasistencia: true },
          { ...base, id: 2, fecha: enDias(1), hora: '19:30', estado: 'confirmada', puedeRegistrarInasistencia: false },
        ],
      },
    });
    renderizar(<CitasDelDia />);
    const pasada = await screen.findByTestId('cita-1');
    const futura = screen.getByTestId('cita-2');
    expect(within(pasada).getByRole('button', { name: 'Registrar inasistencia' })).toBeEnabled();
    expect(within(futura).getByRole('button', { name: 'Registrar inasistencia' })).toBeDisabled();
  });

  it('flujo básico + 6.1: confirma en el modal y muestra el aviso de restricción', async () => {
    const llamadas = simularApi({
      'GET /citas': { body: [{ ...base, id: 1, fecha: enDias(0), hora: '08:00', estado: 'confirmada', puedeRegistrarInasistencia: true }] },
      'POST /citas/1/inasistencia': { body: { inasistencias: 3, restringido: true, aviso: MENSAJES.PACIENTE_RESTRINGIDO } },
    });
    renderizar(<CitasDelDia />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Registrar inasistencia' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/Inasistencias actuales: 2/)).toBeInTheDocument();
    await u.click(within(modal).getByRole('button', { name: 'Registrar inasistencia' }));
    expect(await screen.findByText(MENSAJES.PACIENTE_RESTRINGIDO)).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url === '/api/citas/1/inasistencia')).toBe(true);
  });

  it('muestra el botón de WhatsApp para recordar citas pendientes (P7)', async () => {
    simularApi({ 'GET /citas': { body: [{ ...base, id: 3, fecha: enDias(2), hora: '10:00', estado: 'pendiente_confirmacion', puedeRegistrarInasistencia: false, whatsapp: 'https://wa.me/51949123456?text=hola' }] } });
    renderizar(<CitasDelDia />);
    expect(await screen.findByRole('link', { name: 'Recordar por WhatsApp' })).toHaveAttribute('href', 'https://wa.me/51949123456?text=hola');
  });
});

describe('CU-07 MisCitas', () => {
  it('con más de 24 h: puede reprogramar o cancelar; con menos, ve el aviso de comunicarse con la clínica', async () => {
    simularApi({
      'GET /citas/mias': {
        body: [
          { ...base, id: 1, fecha: enDias(5), hora: '10:00', estado: 'pendiente_confirmacion' },
          { ...base, id: 2, ...enHoras(10), estado: 'confirmada' },
          { ...base, id: 3, fecha: enDias(-3), hora: '10:00', estado: 'atendida' },
        ],
      },
    });
    renderizar(<MisCitas />);
    await screen.findAllByText(/Dr. Luis Paredes/);
    expect(screen.getAllByRole('button', { name: 'Reprogramar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Cancelar' })).toHaveLength(1);
  });

  it('cancelar: pide confirmación y llama a la API', async () => {
    const llamadas = simularApi({
      'GET /citas/mias': [{ body: [{ ...base, id: 1, fecha: enDias(5), hora: '10:00', estado: 'pendiente_confirmacion' }] }, { body: [{ ...base, id: 1, fecha: enDias(5), hora: '10:00', estado: 'cancelada' }] }],
      'PATCH /citas/1/cancelar': { body: { ...base, id: 1, estado: 'cancelada' } },
    });
    renderizar(<MisCitas />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, cancelar' }));
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PATCH')).toBe(true));
  });
});
