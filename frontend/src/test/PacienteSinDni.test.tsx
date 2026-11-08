// Búsqueda por nombre, registro sin DNI («DNI pendiente») y CU-58 Editar datos (precargados)
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NuevaCita from '../pages/NuevaCita';
import { ModalEditarDatos } from '../components/ModalEditarDatos';
import { renderizar, simularApi } from './utils';

const maria = { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '949123456', email: null, direccion: null, apoderado: null, sexo: 'femenino', inasistencias: 0, restringido: false };
const encontrada = { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', edad: 36, celular: '***-***-456' };

describe('Nueva cita: pestañas «Registrar por DNI» y «Registrar sin DNI»', () => {
  it('ya no busca por nombre (eso está en «Buscar cita»)', () => {
    simularApi({});
    renderizar(<NuevaCita />);
    expect(screen.queryByRole('button', { name: 'Registrar por nombre' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Buscar cita' })).toHaveAttribute('href', '/citas/buscar');
  });

  it('«Sacar otra cita» con un paciente sin DNI abre la pestaña «Registrar sin DNI» con el paciente cargado', async () => {
    simularApi({ 'GET /pacientes/9': { body: { ...maria, id: 9, dni: null, nombres: 'José', apellidos: 'Pérez' } }, 'GET /odontologos': { body: [] } });
    renderizar(<NuevaCita />, '/citas/nueva?paciente=9');
    expect(await screen.findByText('José Pérez')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar sin DNI' })).toHaveClass('active');
    expect(screen.queryByRole('heading', { name: 'Registrar paciente sin DNI' })).toBeNull(); // no muestra el formulario vacío
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
  });

  it('«Sacar otra cita» con un paciente con DNI abre «Registrar por DNI» con su DNI escrito', async () => {
    simularApi({ 'GET /pacientes/1': { body: maria }, 'GET /odontologos': { body: [] } });
    renderizar(<NuevaCita />, '/citas/nueva?paciente=1');
    expect(await screen.findByText('María Quispe Rojas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar por DNI' })).toHaveClass('active');
    expect(screen.getByLabelText('DNI del paciente')).toHaveValue('72458190');
  });
});

describe('Registro sin DNI', () => {
  async function llenar(u: ReturnType<typeof userEvent.setup>) {
    await u.click(screen.getAllByRole('button', { name: 'Registrar sin DNI' })[0]);
    await u.type(screen.getByLabelText('Nombres'), 'Juana');
    await u.type(screen.getByLabelText('Apellidos'), 'Rosales Mendoza');
    await u.type(screen.getByLabelText('Fecha de nacimiento'), '1988-03-14');
    await u.type(screen.getByLabelText('Celular'), '951234567');
  }

  it('el sexo es obligatorio; si hay parecidos pregunta «¿Es alguno?» y luego registra con «No es ninguno»', async () => {
    const llamadas = simularApi({
      'GET /pacientes/por-nombre': { body: [{ ...encontrada, id: 7, dni: null, nombres: 'Juana', apellidos: 'Rosales Mendoza', fechaNacimiento: '1988-03-14', edad: 38 }] },
      'POST /pacientes/sin-dni': { status: 201, body: { ...maria, id: 9, dni: null, nombres: 'Juana', apellidos: 'Rosales Mendoza' } },
      'GET /odontologos': { body: [] },
    });
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await llenar(u);
    await u.click(screen.getAllByRole('button', { name: 'Registrar sin DNI' }).at(-1)!);
    expect(await screen.findByText('Elija el sexo')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Femenino' }));
    await u.click(screen.getAllByRole('button', { name: 'Registrar sin DNI' }).at(-1)!);
    expect(await screen.findByText('¿Es alguno de estos pacientes?')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
    await u.click(screen.getByRole('button', { name: 'No es ninguno: registrar sin DNI' }));
    expect(await screen.findByText('Juana Rosales Mendoza')).toBeInTheDocument();
    expect(screen.getByText('Juana Rosales Mendoza').parentElement).toHaveTextContent('DNI pendiente');
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toMatchObject({ nombres: 'Juana', apellidos: 'Rosales Mendoza', sexo: 'femenino', telefono: '951234567' });
  });
});

describe('Fecha de nacimiento', () => {
  it('no deja registrar con una fecha futura', async () => {
    const llamadas = simularApi({});
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await u.click(screen.getAllByRole('button', { name: 'Registrar sin DNI' })[0]);
    await u.type(screen.getByLabelText('Nombres'), 'Juana');
    await u.type(screen.getByLabelText('Apellidos'), 'Rosales');
    await u.type(screen.getByLabelText('Fecha de nacimiento'), '2099-01-09');
    await u.type(screen.getByLabelText('Celular'), '951234567');
    await u.click(screen.getByRole('button', { name: 'Femenino' }));
    await u.click(screen.getAllByRole('button', { name: 'Registrar sin DNI' }).at(-1)!);
    expect(await screen.findByText('La fecha de nacimiento no puede ser futura')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de nacimiento')).toHaveAttribute('max');
    expect(llamadas).toHaveLength(0);
  });
});

describe('CU-58 Editar datos', () => {
  it('los campos vienen llenos; sin cambios no se puede guardar; lo cambiado muestra «Antes» y se puede deshacer', async () => {
    simularApi({ 'GET /pacientes/1': { body: maria } });
    renderizar(<ModalEditarDatos pacienteId={1} onCerrar={() => {}} />);
    const u = userEvent.setup();
    expect(await screen.findByDisplayValue('Quispe Rojas')).toBeInTheDocument();
    expect(screen.getByLabelText('Celular')).toHaveValue('949123456');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    const cel = screen.getByLabelText('Celular');
    await u.clear(cel);
    await u.type(cel, '987000111');
    expect(screen.getByText(/Antes: «949123456»/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Motivo de la corrección/)).not.toBeInTheDocument(); // contacto: sin motivo
    await u.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByLabelText('Celular')).toHaveValue('949123456');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('cambiar un dato de identidad pide el motivo y lo envía', async () => {
    const llamadas = simularApi({
      'GET /pacientes/1': { body: maria },
      'PATCH /pacientes/1': { body: { paciente: { ...maria, apellidos: 'Quispe Ramos' }, cambios: ['Apellidos'] } },
    });
    renderizar(<ModalEditarDatos pacienteId={1} onCerrar={() => {}} />);
    const u = userEvent.setup();
    const ap = await screen.findByDisplayValue('Quispe Rojas');
    await u.clear(ap);
    await u.type(ap, 'Quispe Ramos');
    await u.type(screen.getByLabelText(/Motivo de la corrección/), 'Se escribió mal el apellido');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios (1)' }));
    expect(await screen.findByText(/Se guardó: Apellidos/)).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'PATCH')?.body).toMatchObject({ apellidos: 'Quispe Ramos', motivo: 'Se escribió mal el apellido', telefono: '949123456' });
  });

  it('DNI pendiente: la recepcionista lo completa; si RENIEC no coincide, avisa y deja confirmar', async () => {
    const llamadas = simularApi({
      'GET /pacientes/9': { body: { ...maria, id: 9, dni: null } },
      'PUT /pacientes/9/dni': [
        { status: 409, body: { codigo: 'DNI_RENIEC_NO_COINCIDE', mensaje: 'no coincide', campos: { reniec: 'Pedro López' } } },
        { body: { ...maria, id: 9, dni: '45123987' } },
      ],
    });
    renderizar(<ModalEditarDatos pacienteId={9} onCerrar={() => {}} />);
    const u = userEvent.setup();
    const seccion = await screen.findByTestId('seccion-dni');
    expect(within(seccion).getByText('DNI pendiente')).toBeInTheDocument();
    await u.click(within(seccion).getByRole('button', { name: 'Completar DNI' }));
    await u.type(within(seccion).getByLabelText('DNI'), '45123987');
    await u.click(within(seccion).getByRole('button', { name: 'Guardar DNI' }));
    expect(await within(seccion).findByText('Pedro López')).toBeInTheDocument();
    await u.click(within(seccion).getByRole('button', { name: 'Es correcto: guardar de todos modos' }));
    await waitFor(() => expect(within(seccion).getByText('DNI 45123987')).toBeInTheDocument());
    expect(llamadas.filter((l) => l.metodo === 'PUT').map((l) => (l.body as { confirmar: boolean }).confirmar)).toEqual([false, true]);
  });

  it('pestaña de la cita: con el adelanto pagado el tratamiento está bloqueado; el motivo sí se edita', async () => {
    const cita = { id: 5, pacienteId: 1, odontologoId: 1, odontologo: 'Dr. Luis Paredes', fecha: '2030-01-07', hora: '10:00', motivo: 'Revisión', canal: 'presencial', estado: 'confirmada', tratamientoPrevisto: 'Consulta', tratamientoPrevistoId: 1, montoAdelanto: '20.00', adelantoVenceEn: null, adelantoPagado: '20.00', pagoReportado: null, pagoRechazoMotivo: null } as const;
    const llamadas = simularApi({
      'GET /pacientes/1': { body: maria },
      'GET /tarifario': { body: [{ id: 1, nombre: 'Consulta', precio: '40.00' }, { id: 2, nombre: 'Profilaxis', precio: '80.00' }] },
      'PATCH /citas/5/datos': { body: { ...cita, motivo: 'Dolor al masticar' } },
    });
    renderizar(<ModalEditarDatos pacienteId={1} cita={cita} onCerrar={() => {}} />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Datos de la cita' }));
    expect(screen.getByLabelText('Tratamiento previsto')).toBeDisabled();
    expect(screen.getByText(/el adelanto de S\/ 20\.00 ya se pagó/)).toBeInTheDocument();
    const motivo = screen.getByLabelText('Motivo');
    await u.clear(motivo);
    await u.type(motivo, 'Dolor al masticar');
    await u.click(screen.getByRole('button', { name: 'Guardar datos de la cita' }));
    expect(await screen.findByText(/Se guardaron los datos de la cita/)).toBeInTheDocument();
    expect(llamadas.find((l) => l.metodo === 'PATCH')?.body).toEqual({ motivo: 'Dolor al masticar' });
  });
});
