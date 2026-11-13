// Anular comprobante, editar atención, desbloquear cuenta y auditoría
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { MENSAJES } from '@clinica/shared';
import Caja from '../pages/Caja';
import EditarAtencion from '../pages/EditarAtencion';
import Usuarios from '../pages/Usuarios';
import Auditoria from '../pages/Auditoria';
import Login from '../pages/Login';
import { VistaHistorial } from '../components/VistaHistorial';
import { AuthProvider } from '../auth';
import { renderizar, simularApi } from './utils';
import type { Historial } from '../api/recursos';

const delDia = [
  { id: 2, numero: 'C-000002', tipo: 'servicio', citaId: 7, fecha: '2026-11-04T15:00:00Z', paciente: 'Quispe Rojas, María', dni: '72458190', tipoPago: 'Tarjeta', total: '80.00', anulado: null, puedeAnular: true },
  { id: 1, numero: 'C-000001', tipo: 'servicio', citaId: 6, fecha: '2026-11-04T14:00:00Z', paciente: 'Torres Vega, Lucía', dni: '70112233', tipoPago: 'Efectivo', total: '40.00', anulado: { fecha: '2026-11-04T14:30:00Z', por: 'Ana Ríos', motivo: 'Monto equivocado' }, puedeAnular: false },
];
const cajaBase = { 'GET /caja/pendientes': { body: [] }, 'GET /caja/campanas': { body: [] }, 'GET /caja/comprobantes': { body: delDia } };

describe('Anular comprobante (Caja)', () => {
  it('lista los de hoy; el anulado se ve tachado con su motivo y sin botón', async () => {
    simularApi(cajaBase);
    renderizar(<Caja />);
    const anulado = (await screen.findByText('C-000001')).closest('.list-group-item') as HTMLElement;
    expect(within(anulado).getByText('Anulado')).toBeInTheDocument();
    expect(within(anulado).getByText('Anulado por Ana Ríos: Monto equivocado')).toBeInTheDocument();
    expect(within(anulado).queryByRole('button', { name: 'Anular' })).toBeNull();
  });

  it('pide el motivo, explica qué pasa y envía la anulación', async () => {
    const llamadas = simularApi({
      ...cajaBase,
      'PATCH /comprobantes/2/anular': { body: { id: 2, numero: 'C-000002', tipo: 'servicio', estadoCita: 'atendida' } },
    });
    renderizar(<Caja />);
    const u = userEvent.setup();
    const fila = (await screen.findByText('C-000002')).closest('.list-group-item') as HTMLElement;
    await u.click(within(fila).getByRole('button', { name: 'Anular' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/La cita vuelve a «Atendida»/)).toBeInTheDocument();
    await u.click(within(modal).getByRole('button', { name: 'Anular comprobante' }));
    expect(within(modal).getByText('Indique el motivo (mínimo 5 caracteres)')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'PATCH')).toBe(false);
    await u.type(within(modal).getByLabelText('Motivo *'), 'Se cobró el tratamiento equivocado');
    await u.click(within(modal).getByRole('button', { name: 'Anular comprobante' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'PATCH')?.body).toEqual({ motivo: 'Se cobró el tratamiento equivocado' }));
    expect(await screen.findByText(/C-000002 anulado\. La cita volvió a «Por cobrar»/)).toBeInTheDocument();
  });

  it('muestra el error del servidor (p. ej. saldo ya usado)', async () => {
    simularApi({ ...cajaBase, 'PATCH /comprobantes/2/anular': { status: 409, body: { codigo: 'SALDO_YA_USADO', mensaje: MENSAJES.SALDO_YA_USADO } } });
    renderizar(<Caja />);
    const u = userEvent.setup();
    const fila = (await screen.findByText('C-000002')).closest('.list-group-item') as HTMLElement;
    await u.click(within(fila).getByRole('button', { name: 'Anular' }));
    await u.type(screen.getByLabelText('Motivo *'), 'Error de cobro');
    await u.click(screen.getByRole('button', { name: 'Anular comprobante' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJES.SALDO_YA_USADO);
  });
});

const editable = {
  id: 9, citaId: 7, fecha: '2026-11-04', hora: '09:00', motivo: 'Dolor',
  paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', alergias: null },
  diagnostico: 'Caries en 16', observaciones: null,
  tratamientos: [{ tratamientoId: 1, piezaDental: '16', nombre: 'Curación con resina', precio: '120.00' }], cobrada: false,
};
const tarifario = [{ id: 1, nombre: 'Curación con resina', precio: '120.00', activo: true, insumos: [] }, { id: 2, nombre: 'Profilaxis', precio: '80.00', activo: true, insumos: [] }];
const editar = () =>
  renderizar(
    <Routes><Route path="/atencion/editar/:atencionId" element={<EditarAtencion />} /></Routes>,
    '/atencion/editar/9',
  );

describe('Editar atención', () => {
  it('carga los datos, exige motivo y envía la corrección', async () => {
    const llamadas = simularApi({
      'GET /atenciones/9': { body: editable },
      'GET /tratamientos': { body: tarifario },
      'PATCH /atenciones/9': { body: { atencionId: 9, citaId: 7, tratamientosCambiados: false, insumos: [], alertas: [] } },
    });
    editar();
    const u = userEvent.setup();
    const diag = await screen.findByLabelText('Diagnóstico');
    await waitFor(() => expect(diag).toHaveValue('Caries en 16'));
    await u.clear(diag);
    await u.type(diag, 'Caries en 26');
    await u.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(screen.getByText('Indique el motivo (mínimo 5 caracteres)')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Motivo de la corrección *'), 'Me equivoqué de pieza');
    await u.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    await waitFor(() =>
      expect(llamadas.find((l) => l.metodo === 'PATCH')?.body).toEqual({ diagnostico: 'Caries en 26', motivo: 'Me equivoqué de pieza', tratamientos: [{ tratamientoId: 1, piezaDental: '16' }] }),
    );
    expect(await screen.findByText('Atención corregida')).toBeInTheDocument();
  });

  it('ya cobrada: avisa y no deja cambiar los tratamientos', async () => {
    simularApi({ 'GET /atenciones/9': { body: { ...editable, cobrada: true } }, 'GET /tratamientos': { body: tarifario } });
    editar();
    expect(await screen.findByText(/ya fue cobrada/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tratamiento 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '+ Agregar otro tratamiento' })).toBeNull();
  });

  it('de otro odontólogo: muestra el mensaje del servidor', async () => {
    simularApi({ 'GET /atenciones/9': { status: 403, body: { codigo: 'ATENCION_NO_EDITABLE', mensaje: MENSAJES.ATENCION_NO_EDITABLE } }, 'GET /tratamientos': { body: tarifario } });
    editar();
    expect(await screen.findByText(MENSAJES.ATENCION_NO_EDITABLE)).toBeInTheDocument();
  });
});

describe('Historial con correcciones', () => {
  it('muestra «Editado», quién, el motivo y lo que decía antes', async () => {
    const h: Historial = {
      paciente: { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '987111222', apoderado: null, inasistencias: 0 },
      ficha: { alergias: null, antecedentes: null, notas: null },
      atenciones: [{
        id: 9, fecha: '2026-11-04', hora: '09:00', motivo: 'Dolor', odontologo: 'Dr. Luis Paredes', odontologoId: 1, diagnostico: 'Caries en 26', observaciones: null,
        tratamientos: [{ nombre: 'Curación con resina', piezaDental: '26', precio: '120.00' }],
        ediciones: [{ fecha: '2026-11-04T15:00:00Z', por: 'Dr. Luis Paredes', motivo: 'Me equivoqué de pieza', anterior: { diagnostico: 'Caries en 16', observaciones: null, tratamientos: [{ nombre: 'Curación con resina', piezaDental: '16' }] } }],
      }],
    };
    renderizar(<VistaHistorial h={h} />);
    expect(screen.getByText('Editado')).toBeInTheDocument();
    expect(screen.getByText(/Editado el 04\/11\/2026.*por Dr\. Luis Paredes – motivo: Me equivoqué de pieza/)).toBeInTheDocument();
    expect(screen.getByText('Antes decía — diagnóstico: Caries en 16')).toBeInTheDocument();
    expect(screen.getByText('Tratamientos: Curación con resina — pieza 16 · primer molar superior derecho')).toBeInTheDocument();
  });
});

describe('Bloqueo de inicio de sesión', () => {
  it('Login muestra cuántos intentos quedan y el bloqueo', async () => {
    simularApi({
      'GET /auth/yo': { status: 401, body: { codigo: 'NO_AUTENTICADO', mensaje: 'x' } },
      'POST /auth/login': [
        { status: 401, body: { codigo: 'CREDENCIALES_INVALIDAS', mensaje: `${MENSAJES.CREDENCIALES_INVALIDAS}. Le queda 1 intento` } },
        { status: 423, body: { codigo: 'CUENTA_BLOQUEADA', mensaje: `${MENSAJES.CUENTA_BLOQUEADA}. Intente de nuevo a las 16:05` } },
      ],
    });
    renderizar(<AuthProvider><Login /></AuthProvider>);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Correo'), 'ana.rios@clinica.local');
    await u.type(screen.getByLabelText('Contraseña'), 'mala');
    await u.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le queda 1 intento');
    await u.click(screen.getByRole('button', { name: 'Ingresar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Intente de nuevo a las 16:05'));
  });

  it('Usuarios: el Administrador ve la cuenta bloqueada y la desbloquea', async () => {
    const ana = { id: 2, nombres: 'Ana Ríos', email: 'ana.rios@clinica.local', rol: 'recepcionista', activo: true, cmp: null, especialidad: null, dni: null, bloqueadoHasta: '2026-11-04T21:05:00Z' };
    const llamadas = simularApi({
      'GET /auth/yo': { body: { id: 1, nombres: 'Carlos Vega', email: 'carlos.vega@clinica.local', rol: 'administrador', pacienteId: null, odontologoId: null } },
      'GET /usuarios': [{ body: [ana] }, { body: [{ ...ana, bloqueadoHasta: null }] }],
      'PATCH /usuarios/2/desbloquear': { body: { bloqueadoHasta: null } },
    });
    renderizar(<AuthProvider><Usuarios /></AuthProvider>);
    const u = userEvent.setup();
    expect(await screen.findByText('Bloqueado hasta las 16:05')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PATCH' && l.url.endsWith('/usuarios/2/desbloquear'))).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Bloqueado hasta/)).toBeNull());
  });
});

describe('Auditoría', () => {
  it('lista quién vio qué historial y filtra por DNI', async () => {
    const llamadas = simularApi({
      'GET /usuarios': { body: [] },
      'GET /admin/auditoria': {
        body: {
          eventos: [{ id: 1, fecha: '2026-11-04T15:00:00Z', accion: 'ver_historial', usuario: { id: 3, nombres: 'Dr. Luis Paredes', email: 'luis.paredes@clinica.local', rol: 'odontologo' }, paciente: { id: 1, dni: '72458190', nombres: 'Quispe Rojas, María' }, detalle: null, ip: '127.0.0.1' }],
          hayMas: false,
        },
      },
    });
    renderizar(<Auditoria />);
    const fila = (await screen.findByRole('cell', { name: 'Vio el historial clínico' })).closest('tr') as HTMLElement;
    expect(fila).toHaveTextContent('Dr. Luis Paredes');
    expect(fila).toHaveTextContent('Odontólogo');
    expect(fila).toHaveTextContent('DNI 72458190');
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '7245');
    expect(screen.getByText('El DNI tiene 8 dígitos')).toBeInTheDocument();
    await u.type(screen.getByLabelText('DNI del paciente'), '8190');
    await waitFor(() => expect(llamadas.some((l) => l.url.includes('dni=72458190'))).toBe(true));
  });
});
