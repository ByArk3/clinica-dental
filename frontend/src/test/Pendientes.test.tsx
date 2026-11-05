// Mostrar contraseña, autocompletar con RENIEC y configuración de pagos (billeteras y QR)
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NuevaCita from '../pages/NuevaCita';
import Configuracion from '../pages/Configuracion';
import { CampoPassword } from '../components/CampoPassword';
import { renderizar, simularApi } from './utils';
import { useState } from 'react';

const noEncontrado = { status: 404, body: { codigo: 'PACIENTE_NO_ENCONTRADO', mensaje: 'Paciente no encontrado' } };

describe('Mostrar contraseña', () => {
  it('el botón del ojo muestra y oculta lo escrito', async () => {
    function Prueba() {
      const [v, setV] = useState('');
      return (<><label htmlFor="pw">Contraseña</label><CampoPassword id="pw" value={v} onChange={setV} /></>);
    }
    renderizar(<Prueba />);
    const u = userEvent.setup();
    const campo = screen.getByLabelText('Contraseña');
    await u.type(campo, 'Secreta1');
    expect(campo).toHaveAttribute('type', 'password');
    await u.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(campo).toHaveAttribute('type', 'text');
    await u.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(campo).toHaveAttribute('type', 'password');
  });
});

describe('Autocompletar con RENIEC (Nueva cita)', () => {
  const buscar = async () => {
    renderizar(<NuevaCita />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('DNI del paciente'), '45678912');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    return u;
  };

  it('DNI nuevo: completa nombres y apellidos y avisa que se verifiquen', async () => {
    simularApi({ 'GET /pacientes': noEncontrado, 'GET /reniec/45678912': { body: { encontrado: true, nombres: 'Juan Carlos', apellidos: 'De la Cruz Quispe' } } });
    await buscar();
    await waitFor(() => expect(screen.getByLabelText('Nombres')).toHaveValue('Juan Carlos'));
    expect(screen.getByLabelText('Apellidos')).toHaveValue('De la Cruz Quispe');
    expect(screen.getByText(/se completaron con una consulta a RENIEC/)).toBeInTheDocument();
  });

  it('sin proveedor configurado: formulario vacío, sin avisos', async () => {
    simularApi({ 'GET /pacientes': noEncontrado, 'GET /reniec/45678912': { body: { encontrado: false, motivo: 'no_configurado' } } });
    await buscar();
    expect(await screen.findByLabelText('Nombres')).toHaveValue('');
    await waitFor(() => expect(screen.queryByText(/RENIEC/)).toBeNull());
  });

  it('proveedor no disponible: avisa y deja escribir a mano', async () => {
    simularApi({ 'GET /pacientes': noEncontrado, 'GET /reniec/45678912': { body: { encontrado: false, motivo: 'no_disponible' } } });
    await buscar();
    expect(await screen.findByText('No se pudo consultar RENIEC ahora; escriba los datos a mano.')).toBeInTheDocument();
  });

  it('CU-57 es «extend»: con la API de RENIEC caída (error de red) el registro sigue a mano y se guarda', async () => {
    const llamadas = simularApi({
      'GET /pacientes': noEncontrado,
      'POST /pacientes': { status: 201, body: { id: 9, dni: '45678912', nombres: 'Raúl', apellidos: 'Gómez', fechaNacimiento: '1970-02-02', telefono: '911222333', email: null, inasistencias: 0, restringido: false } },
      'GET /odontologos': { body: [] },
    });
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reniec/')) throw new TypeError('Failed to fetch'); // proveedor o red caída
      return fetchOriginal(input, init);
    }) as typeof fetch;
    try {
      const u = await buscar();
      await u.type(await screen.findByLabelText('Nombres'), 'Raúl');
      await u.type(screen.getByLabelText('Apellidos'), 'Gómez');
      await u.type(screen.getByLabelText('Fecha de nacimiento'), '1970-02-02');
      await u.type(screen.getByLabelText('Celular'), '911222333');
      await u.click(screen.getByRole('button', { name: 'Registrar paciente' }));
      await waitFor(() => expect(llamadas.find((l) => l.metodo === 'POST')?.body).toMatchObject({ dni: '45678912', nombres: 'Raúl', apellidos: 'Gómez' }));
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  it('no pisa lo que la recepcionista ya escribió', async () => {
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((r) => (soltar = r));
    simularApi({ 'GET /pacientes': noEncontrado, 'GET /reniec/45678912': { body: { encontrado: true, nombres: 'Juan', apellidos: 'Pérez' } } });
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reniec/')) await espera;
      return fetchOriginal(input, init);
    }) as typeof fetch;
    const u = await buscar();
    await u.type(await screen.findByLabelText('Nombres'), 'José');
    soltar();
    await waitFor(() => expect(screen.getByLabelText('Apellidos')).toHaveValue('Pérez'));
    expect(screen.getByLabelText('Nombres')).toHaveValue('José');
    globalThis.fetch = fetchOriginal;
  });
});

describe('Configuración → Pagos', () => {
  const datos = { numero: '987799567', titular: 'Clínica Dental', billeteras: ['yape'], tieneQr: false, saldoVigenciaMeses: 12 };
  const abrir = async () => {
    renderizar(<Configuracion />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Pagos (Yape / Plin)' }));
    return u;
  };

  it('billeteras: hoy solo Yape; debe quedar al menos una; guarda las marcadas', async () => {
    const llamadas = simularApi({ 'GET /admin/descuentos': { body: [] }, 'GET /admin/pago': { body: datos }, 'PUT /admin/pago': { body: { ...datos, billeteras: ['yape', 'plin'] } } });
    const u = await abrir();
    const yape = await screen.findByLabelText('Yape');
    await waitFor(() => expect(yape).toBeChecked());
    expect(screen.getByLabelText('Plin')).not.toBeChecked();
    expect(screen.getByText('En Caja, el tipo de pago se llamará «Yape».')).toBeInTheDocument();
    await u.click(yape);
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Marque al menos una billetera')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'PUT')).toBe(false);
    await u.click(screen.getByLabelText('Plin'));
    await u.click(yape);
    expect(screen.getByText('En Caja, el tipo de pago se llamará «Yape/Plin».')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'PUT')?.body).toEqual({ numero: '987799567', titular: 'Clínica Dental', billeteras: ['plin', 'yape'], saldoVigenciaMeses: 12 }));
  });

  it('sube el QR y lo muestra; rechaza un archivo que no es imagen', async () => {
    const llamadas = simularApi({ 'GET /admin/descuentos': { body: [] }, 'GET /admin/pago': { body: datos }, 'PUT /admin/pago/qr': { body: { ...datos, tieneQr: true } } });
    const u = await abrir();
    expect(await screen.findByText('Todavía no hay un QR cargado.')).toBeInTheDocument();
    const archivo = screen.getByLabelText(/Subir QR/);
    await userEvent.setup({ applyAccept: false }).upload(archivo, new File(['hola'], 'nota.txt', { type: 'text/plain' }));
    expect(screen.getByText('El QR debe ser una imagen PNG, JPG o WEBP')).toBeInTheDocument();
    await u.upload(archivo, new File([new Uint8Array([137, 80, 78, 71])], 'qr.png', { type: 'image/png' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'PUT')?.body).toEqual({ qr: expect.stringMatching(/^data:image\/png;base64,/) }));
    expect(await screen.findByRole('img', { name: 'QR de pago de la clínica' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar QR' })).toBeInTheDocument();
  });
});
