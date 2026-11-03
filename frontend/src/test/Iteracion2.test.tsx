import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { MENSAJES } from '@clinica/shared';
import RegistrarAtencion from '../pages/RegistrarAtencion';
import Historial from '../pages/Historial';
import Tarifario from '../pages/Tarifario';
import { calcularConsumo } from '../components/TablaInsumos';
import { renderizar, simularApi } from './utils';

const resina = { insumoId: 1, nombre: 'Resina compuesta A2', unidad: 'jeringa', cantidad: '1.00', stockActual: '5.00', stockMinimo: '5.00' };
const guantes = { insumoId: 3, nombre: 'Guantes de nitrilo M', unidad: 'par', cantidad: '1.00', stockActual: '7.00', stockMinimo: '10.00' };
const anestesia = { insumoId: 2, nombre: 'Anestesia lidocaína 2 %', unidad: 'cartucho', cantidad: '1.00', stockActual: '18.00', stockMinimo: '10.00' };
const tarifario = [
  { id: 1, nombre: 'Curación con resina', precio: '120.00', activo: true, insumos: [resina, anestesia, guantes] },
  { id: 5, nombre: 'Consulta', precio: '40.00', activo: true, insumos: [guantes] },
];
const cita = { id: 9, fecha: '2026-11-03', hora: '10:00', motivo: 'Dolor', estado: 'confirmada', puedeAtender: true, paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', alergias: 'Penicilina' } };
const historial = {
  paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '949123456', apoderado: null, inasistencias: 0 },
  ficha: { alergias: 'Penicilina', antecedentes: null, notas: null },
  atenciones: [],
  mensaje: MENSAJES.SIN_ATENCIONES,
};

describe('calcularConsumo (CU-11 5.1)', () => {
  it('suma por insumo los consumos de varios tratamientos', () => {
    const f = calcularConsumo(tarifario);
    expect(f.find((x) => x.nombre === 'Guantes de nitrilo M')).toMatchObject({ cantidad: 2, stockActual: 7, resultante: 5 });
    expect(f).toHaveLength(3);
  });
});

const atender = () =>
  renderizar(<Routes><Route path="/atencion/:citaId" element={<RegistrarAtencion />} /></Routes>, '/atencion/9?fecha=2026-11-03');

describe('CU-11 RegistrarAtencion', () => {
  it('flujo básico: elige tratamiento y pieza, muestra insumos a descontar y guarda', async () => {
    const llamadas = simularApi({
      'GET /odontologos/me/citas': { body: [cita] },
      'GET /pacientes/1/historial': { body: historial },
      'GET /tratamientos': { body: tarifario },
      'POST /citas/9/atencion': {
        status: 201,
        body: { atencionId: 1, citaId: 9, total: '120.00', alertas: ['Resina compuesta A2'], insumos: [{ insumo: 'Resina compuesta A2', unidad: 'jeringa', cantidad: '-1.00', saldo: '4.00', alertaGenerada: true }] },
      },
    });
    atender();
    const u = userEvent.setup();
    expect(await screen.findByRole('note')).toHaveTextContent('Alergias: Penicilina'); // aviso de alergias arriba
    await waitFor(() => expect(screen.getAllByText('Penicilina')).toHaveLength(2)); // y en la ficha
    await u.type(screen.getByLabelText('Diagnóstico *'), 'Caries en 16');
    await screen.findByRole('option', { name: /Curación con resina/ });
    await u.selectOptions(screen.getByLabelText('Tratamiento 1'), '1');
    await u.click(screen.getByRole('button', { name: 'Pieza 16' }));
    // tabla de insumos: la resina quedará en el mínimo
    const fila = screen.getByText('Resina compuesta A2').closest('tr')!;
    expect(within(fila).getByText('Quedará en stock mínimo: se generará alerta')).toBeInTheDocument();
    expect(screen.getByText('S/ 120.00')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Guardar atención' }));
    expect(await screen.findByText('Atención registrada')).toBeInTheDocument();
    expect(screen.getByText(/Stock mínimo alcanzado: Resina compuesta A2/)).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ diagnostico: 'Caries en 16', tratamientos: [{ tratamientoId: 1, piezaDental: '16' }] });
  });

  it('5.1: con dos tratamientos suma total e insumos', async () => {
    simularApi({ 'GET /odontologos/me/citas': { body: [cita] }, 'GET /pacientes/1/historial': { body: historial }, 'GET /tratamientos': { body: tarifario } });
    atender();
    const u = userEvent.setup();
    await screen.findByRole('option', { name: /Consulta/ });
    await u.selectOptions(screen.getByLabelText('Tratamiento 1'), '1');
    await u.click(screen.getByRole('button', { name: '+ Agregar otro tratamiento' }));
    await u.selectOptions(screen.getByLabelText('Tratamiento 2'), '5');
    expect(screen.getByText('S/ 160.00')).toBeInTheDocument();
    const fila = screen.getByText('Guantes de nitrilo M').closest('tr')!;
    expect(within(fila).getByText('2 par')).toBeInTheDocument();
  });

  it('6.1: sin diagnóstico ni tratamiento resalta los campos y no envía', async () => {
    const llamadas = simularApi({ 'GET /odontologos/me/citas': { body: [cita] }, 'GET /pacientes/1/historial': { body: historial }, 'GET /tratamientos': { body: tarifario } });
    atender();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Guardar atención' }));
    expect(screen.getByText('Ingrese el diagnóstico')).toBeInTheDocument();
    expect(screen.getByText('Agregue al menos un tratamiento')).toBeInTheDocument();
    expect(screen.getByLabelText('Tratamiento 1')).toHaveClass('is-invalid');
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });

  it('cita que ya no está disponible → aviso', async () => {
    simularApi({ 'GET /odontologos/me/citas': { body: [] }, 'GET /tratamientos': { body: tarifario } });
    atender();
    expect(await screen.findByText(/La cita no está disponible para atención/)).toBeInTheDocument();
  });
});

describe('CU-10 Historial', () => {
  it('flujo básico: un resultado → muestra ficha y atenciones', async () => {
    simularApi({
      'GET /pacientes/buscar': { body: [{ id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', atenciones: 1 }] },
      'GET /pacientes/1/historial': {
        body: { ...historial, mensaje: undefined, atenciones: [{ id: 1, fecha: '2026-10-01', hora: '09:00', motivo: 'Dolor', odontologo: 'Dr. Luis Paredes', diagnostico: 'Caries', observaciones: null, tratamientos: [{ nombre: 'Curación con resina', piezaDental: '16', precio: '120.00' }] }] },
      },
    });
    renderizar(<Historial />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI o nombre del paciente'), '72458190');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('01/10/2026 · 09:00')).toBeInTheDocument();
    expect(screen.getByText(/Curación con resina/)).toHaveTextContent('pieza 16');
  });

  it('2.1: sin coincidencias → «Paciente no encontrado»', async () => {
    simularApi({ 'GET /pacientes/buscar': { status: 404, body: { codigo: 'PACIENTE_NO_ENCONTRADO', mensaje: MENSAJES.PACIENTE_NO_ENCONTRADO } } });
    renderizar(<Historial />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI o nombre del paciente'), 'Zzzz');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES.PACIENTE_NO_ENCONTRADO);
  });

  it('5.1: sin atenciones → mensaje', async () => {
    simularApi({
      'GET /pacientes/buscar': { body: [{ id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', atenciones: 0 }] },
      'GET /pacientes/1/historial': { body: historial },
    });
    renderizar(<Historial />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI o nombre del paciente'), 'Quispe');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(MENSAJES.SIN_ATENCIONES)).toBeInTheDocument();
  });

  it('4.1: rol sin permiso → mensaje del servidor', async () => {
    simularApi({ 'GET /pacientes/buscar': { status: 403, body: { codigo: 'SIN_PERMISO', mensaje: MENSAJES.SIN_PERMISO_HISTORIAL } } });
    renderizar(<Historial />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI o nombre del paciente'), 'Quispe');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES.SIN_PERMISO_HISTORIAL);
  });
});

describe('Tarifario CU-14..17', () => {
  it('lista y valida el formulario de nuevo tratamiento antes de enviar', async () => {
    const llamadas = simularApi({ 'GET /tratamientos': { body: tarifario }, 'GET /insumos': { body: [] } });
    renderizar(<Tarifario />);
    const u = userEvent.setup();
    expect(await screen.findByText('Curación con resina')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '+ Agregar tratamiento' }));
    const modal = await screen.findByRole('dialog');
    await u.type(within(modal).getByLabelText('Precio (S/)'), '0');
    await u.click(within(modal).getByRole('button', { name: 'Guardar' }));
    expect(within(modal).getByText('Ingrese el nombre')).toBeInTheDocument();
    expect(within(modal).getByText('El precio debe ser mayor que 0')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });

  it('CU-17: desactivar pide confirmación y llama a la API', async () => {
    const llamadas = simularApi({ 'GET /tratamientos': { body: tarifario }, 'PATCH /tratamientos/5/desactivar': { body: { ...tarifario[1], activo: false } } });
    renderizar(<Tarifario />);
    const u = userEvent.setup();
    const fila = (await screen.findByText('Consulta')).closest('tr')!;
    await u.click(within(fila).getByRole('button', { name: 'Desactivar' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    expect(llamadas.some((l) => l.metodo === 'PATCH' && l.url === '/api/tratamientos/5/desactivar')).toBe(true);
  });
});
