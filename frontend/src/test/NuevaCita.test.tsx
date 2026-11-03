import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NuevaCita from '../pages/NuevaCita';
import { renderizar, simularApi } from './utils';

const maria = { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '949123456', email: null, inasistencias: 0, restringido: false };

describe('NuevaCita presencial (CU-06)', () => {
  it('flujo básico: busca por DNI y muestra al paciente con el formulario de reserva', async () => {
    simularApi({ 'GET /pacientes': { body: maria }, 'GET /odontologos': { body: [] } });
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '72458190');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('María Quispe Rojas')).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
  });

  it('alterno 4.1: DNI no registrado → formulario de paciente nuevo con el DNI precargado; al guardar continúa con la cita', async () => {
    const llamadas = simularApi({
      'GET /pacientes': { status: 404, body: { codigo: 'PACIENTE_NO_ENCONTRADO', mensaje: 'Paciente no encontrado' } },
      'POST /pacientes': { status: 201, body: { ...maria, id: 9, dni: '40404040', nombres: 'Raúl', apellidos: 'Gómez' } },
      'GET /odontologos': { body: [] },
    });
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '40404040');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/Paciente no encontrado/)).toBeInTheDocument();
    expect(screen.getByLabelText('DNI')).toHaveValue('40404040');
    await u.type(screen.getByLabelText('Nombres'), 'Raúl');
    await u.type(screen.getByLabelText('Apellidos'), 'Gómez');
    await u.type(screen.getByLabelText('Fecha de nacimiento'), '1970-02-02');
    await u.type(screen.getByLabelText('Celular'), '911222333');
    await u.click(screen.getByRole('button', { name: 'Registrar paciente' }));
    expect(await screen.findByText('Raúl Gómez')).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toMatchObject({ dni: '40404040', nombres: 'Raúl' });
  });

  it('valida el DNI de 8 dígitos antes de buscar', async () => {
    const llamadas = simularApi({});
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '123');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('El DNI debe tener 8 dígitos')).toBeInTheDocument();
    expect(llamadas).toHaveLength(0);
  });

  it('muestra la alerta de adelanto si el paciente está restringido (RN-12)', async () => {
    simularApi({ 'GET /pacientes': { body: { ...maria, inasistencias: 3, restringido: true } }, 'GET /odontologos': { body: [] } });
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '72458190');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/3 inasistencias — requiere adelanto/)).toBeInTheDocument();
  });
});
