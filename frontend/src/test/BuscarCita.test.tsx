// Buscar cita (recepcionista): encontrar al paciente y ver sus citas próximas (con acciones) y anteriores
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BuscarCita from '../pages/BuscarCita';
import { renderizar, simularApi } from './utils';

const paciente = { id: 47, dni: '49643137', nombres: 'Camila', apellidos: 'Cabrera Narváez', telefono: '916038154', inasistencias: 0, restringido: false, fechaNacimiento: '1955-03-10', saldoFavor: '0.00' };
const base = { pacienteId: 47, odontologoId: 1, canal: 'presencial', tratamientoPrevistoId: 1, adelantoVenceEn: null, pagoRechazoMotivo: null, paciente, puedeRegistrarInasistencia: false };
const citas = {
  paciente,
  proximas: [
    { ...base, id: 329, odontologo: 'Dr. Luis Paredes', fecha: '2030-01-08', hora: '08:00', motivo: 'Revisión general', estado: 'pago_en_verificacion', tratamientoPrevisto: 'Profilaxis', montoAdelanto: '40.00', adelantoPagado: null, pagoReportado: { metodo: 'yape', numeroOperacion: '48213077', reportadoEn: '2030-01-01T00:00:00Z' } },
    { ...base, id: 378, odontologo: 'Dra. Carmen Díaz', fecha: '2030-01-18', hora: '17:00', motivo: 'Sensibilidad al frío', estado: 'confirmada', tratamientoPrevisto: 'Consulta', montoAdelanto: '20.00', adelantoPagado: '20.00', pagoReportado: null, whatsapp: 'https://wa.me/51916038154?text=x' },
  ],
  anteriores: [
    { id: 262, fecha: '2029-10-22', hora: '15:00', odontologo: 'Dra. Carmen Díaz', motivo: 'Limpieza', estado: 'pagada' },
    { id: 46, fecha: '2029-08-21', hora: '10:00', odontologo: 'Dr. Andrés Chávez', motivo: 'Blanqueamiento', estado: 'cancelada' },
  ],
};

describe('Buscar cita', () => {
  it('por nombre: lista con citas próximas; al elegir muestra próximas (con acciones) y anteriores', async () => {
    simularApi({
      'GET /pacientes/por-nombre': { body: [
        { id: 47, dni: '49643137', nombres: 'Camila', apellidos: 'Cabrera Narváez', fechaNacimiento: '1955-03-10', edad: 71, celular: '***-***-154', proximas: 2, siguienteCita: '2030-01-08 08:00' },
        { id: 12, dni: '79718137', nombres: 'Alberto', apellidos: 'Cabrera Asmat', fechaNacimiento: '2013-01-01', edad: 13, celular: '***-***-702', proximas: 0, siguienteCita: null },
      ] },
      'GET /pacientes/47/citas': { body: citas },
    });
    renderizar(<BuscarCita />);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Por nombre' }));
    await u.type(screen.getByLabelText('Apellidos'), 'cabrera');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/2 citas próximas · la siguiente: 08\/01\/2030 08:00/)).toBeInTheDocument();
    expect(screen.getByText('Sin citas próximas')).toBeInTheDocument();
    await u.click(screen.getAllByText('Ver citas')[0]);
    expect(await screen.findByText('Próximas citas (2)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Verificar pago en Caja' })).toBeInTheDocument();
    expect(screen.getByText(/adelanto reportado por Yape \(op\. 48213077\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recordar por WhatsApp' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reprogramar' })).toHaveLength(1); // con el pago en verificación primero se verifica en Caja
    const anteriores = screen.getByRole('table');
    expect(within(anteriores).getByText('Limpieza')).toBeInTheDocument();
    expect(within(anteriores).getByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Sacar otra cita' })).toHaveAttribute('href', '/citas/nueva?paciente=47');
  });

  it('por DNI: va directo a sus citas; si no existe, indica registrarlo en Nueva cita', async () => {
    simularApi({ 'GET /pacientes': [{ status: 404, body: { codigo: 'PACIENTE_NO_ENCONTRADO', mensaje: 'Paciente no encontrado' } }, { body: { ...paciente, email: null } }], 'GET /pacientes/47/citas': { body: { ...citas, proximas: [] } } });
    renderizar(<BuscarCita />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '11111111');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('regístrelo en «Nueva cita»');
    await u.clear(screen.getByLabelText('DNI del paciente'));
    await u.type(screen.getByLabelText('DNI del paciente'), '49643137');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('No tiene citas próximas.')).toBeInTheDocument();
  });
});
