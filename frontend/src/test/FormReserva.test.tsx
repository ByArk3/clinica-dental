import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENSAJES } from '@clinica/shared';
import { FormReserva } from '../components/FormReserva';
import { renderizar, simularApi } from './utils';

const odontologos = { body: [{ id: 1, nombres: 'Dr. Luis Paredes', especialidad: 'Odontología general' }] };
const libres = { body: { fecha: '2030-01-07', atiende: true, horarios: ['08:00', '08:30', '09:00'] } };
const cita = { id: 5, pacienteId: 1, odontologoId: 1, odontologo: 'Dr. Luis Paredes', fecha: '2030-01-07', hora: '08:30', motivo: 'Dolor', canal: 'web', estado: 'pendiente_confirmacion' };

async function elegirOdontologoYFecha(fecha = '2030-01-07') {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText('Motivo'), 'Dolor');
  await screen.findByRole('option', { name: /Luis Paredes/ });
  await u.selectOptions(screen.getByLabelText('Odontólogo'), '1');
  await u.type(screen.getByLabelText('Fecha'), fecha);
  return u;
}

describe('FormReserva (CU-06)', () => {
  it('flujo básico: muestra horarios libres, reserva y confirma con el estado', async () => {
    const llamadas = simularApi({ 'GET /odontologos': odontologos, 'GET /disponibilidad': libres, 'POST /citas': { status: 201, body: { cita } } });
    renderizar(<FormReserva />);
    const u = await elegirOdontologoYFecha();
    await u.click(await screen.findByRole('button', { name: '08:30' }));
    await u.click(screen.getByRole('button', { name: 'Reservar a las 08:30' }));
    expect(await screen.findByText('Cita registrada')).toBeInTheDocument();
    expect(screen.getByText('07/01/2030 a las 08:30 con Dr. Luis Paredes')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de confirmación')).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ odontologoId: 1, fecha: '2030-01-07', hora: '08:30', motivo: 'Dolor' });
  });

  it('alterno 8.1: horario tomado → muestra el mensaje exacto y recarga los horarios', async () => {
    const llamadas = simularApi({
      'GET /odontologos': odontologos,
      'GET /disponibilidad': [libres, { body: { ...libres.body, horarios: ['08:00', '09:00'] } }],
      'POST /citas': { status: 409, body: { codigo: 'HORARIO_NO_DISPONIBLE', mensaje: MENSAJES.HORARIO_NO_DISPONIBLE } },
    });
    renderizar(<FormReserva />);
    const u = await elegirOdontologoYFecha();
    await u.click(await screen.findByRole('button', { name: '08:30' }));
    await u.click(screen.getByRole('button', { name: 'Reservar a las 08:30' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES.HORARIO_NO_DISPONIBLE);
    await waitFor(() => expect(screen.queryByRole('button', { name: '08:30' })).not.toBeInTheDocument());
    expect(llamadas.filter((l) => l.url.startsWith('/api/disponibilidad'))).toHaveLength(2);
  });

  it('alterno 8.2: paciente restringido → muestra el aviso de adelanto', async () => {
    simularApi({
      'GET /odontologos': odontologos,
      'GET /disponibilidad': libres,
      'POST /citas': { status: 201, body: { cita: { ...cita, estado: 'pendiente_adelanto' }, aviso: MENSAJES.ADELANTO_OBLIGATORIO } },
    });
    renderizar(<FormReserva pacienteId={1} />);
    const u = await elegirOdontologoYFecha();
    await u.click(await screen.findByRole('button', { name: '08:30' }));
    await u.click(screen.getByRole('button', { name: 'Reservar a las 08:30' }));
    expect(await screen.findByText(MENSAJES.ADELANTO_OBLIGATORIO)).toBeInTheDocument();
    expect(screen.getByText('Pendiente de adelanto')).toBeInTheDocument();
  });

  it('alterno: día sin atención → mensaje y enlace a la siguiente fecha disponible', async () => {
    simularApi({
      'GET /odontologos': odontologos,
      'GET /disponibilidad': [
        { body: { fecha: '2030-01-06', atiende: false, horarios: [], mensaje: MENSAJES.CLINICA_NO_ATIENDE, siguienteFechaDisponible: '2030-01-07' } },
        libres,
      ],
    });
    renderizar(<FormReserva />);
    const u = await elegirOdontologoYFecha('2030-01-06');
    expect(await screen.findByText(MENSAJES.CLINICA_NO_ATIENDE)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Ver el 07/01/2030' }));
    expect(await screen.findByRole('button', { name: '08:00' })).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toHaveValue('2030-01-07');
  });

  it('6.1: sin horario elegido no envía y marca el error', async () => {
    const llamadas = simularApi({ 'GET /odontologos': odontologos, 'GET /disponibilidad': libres });
    renderizar(<FormReserva />);
    const u = await elegirOdontologoYFecha();
    await screen.findByRole('button', { name: '08:00' });
    await u.click(screen.getByRole('button', { name: 'Reservar cita' }));
    expect(screen.getByText('Elija un horario')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });
});
