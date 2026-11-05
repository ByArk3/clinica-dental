// Interacción: buscador tolerante, pedido desde alertas, modo oscuro, campos de dígitos, copiar y botón que trabaja
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { buscar, puntaje } from '../buscar';
import NuevoPedido from '../pages/NuevoPedido';
import { MenuPorRol } from '../components/MenuPorRol';
import { AuthProvider } from '../auth';
import { BotonAccion, BotonCopiar, CampoDigitos } from '../components/Interaccion';
import { renderizar, simularApi } from './utils';

const ins = (id: number, nombre: string, stock: number, minimo: number, unidad = 'unidad') => ({ id, nombre, unidad, stockActual: String(stock), stockMinimo: String(minimo), bajoMinimo: stock <= minimo, activo: true });
const insumos = [ins(1, 'Anestesia lidocaína 2 %', 18, 10, 'cartucho'), ins(2, 'Barniz de flúor', 30, 10, 'dosis'), ins(3, 'Guantes de nitrilo M', 7, 10, 'par'), ins(4, 'Copa de goma', 12, 5)];

describe('Búsqueda tolerante', () => {
  it('sin tildes, por parte del nombre y con errores de escritura', () => {
    expect(puntaje('Barniz de flúor', 'fluor')).toBe(0);
    expect(puntaje('Guantes de nitrilo M', 'nitri')).toBe(0);
    expect(puntaje('Anestesia lidocaína 2 %', 'anestecia')).toBe(1);
    expect(puntaje('Copa de goma', 'resina')).toBeNull();
    // sin texto: todos, primero los prioritarios (en stock mínimo)
    expect(buscar(insumos, '', (i) => i.bajoMinimo).map((r) => r.item.nombre)[0]).toBe('Guantes de nitrilo M');
  });
});

describe('Nuevo pedido', () => {
  const proveedores = [{ id: 1, ruc: '20601234567', razonSocial: 'Distribuidora Odontomed S.A.C.', contacto: null, telefono: null, email: null, activo: true }, { id: 2, ruc: '20487654321', razonSocial: 'Dental Sur E.I.R.L.', contacto: null, telefono: null, email: null, activo: true }];
  const historial = { pedidos: [{ id: 9, codigo: 'PED-0009', estado: 'recibido', fecha: '2026-10-01T15:00:00Z', recibidoEn: null, motivoAnulacion: null, observacionRecepcion: null, registradoPor: 'Carlos Vega', proveedor: { id: 2, ruc: '20487654321', razonSocial: 'Dental Sur E.I.R.L.', email: null }, detalles: [{ id: 1, insumoId: 3, insumo: 'Guantes de nitrilo M', unidad: 'par', stockActual: '7', cantidadPedida: '20', cantidadRecibida: '20' }] }] };

  it('desde una alerta: aviso, insumo resaltado «Desde alerta», proveedor sugerido y buscador «Agregar otro insumo»', async () => {
    simularApi({ 'GET /proveedores': { body: proveedores }, 'GET /insumos': { body: insumos }, 'GET /pedidos': { body: historial } });
    renderizar(<Routes><Route path="/pedidos/nuevo" element={<NuevoPedido />} /></Routes>, '/pedidos/nuevo?insumos=3');
    expect((await screen.findByText(/Pedido desde Alertas de stock/)).closest('.alert')).toHaveTextContent('Ya se agregó Guantes de nitrilo M con 13 par sugeridos');
    expect(screen.getByText('Desde alerta')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Proveedor')).toHaveValue('2'));
    expect(screen.getByText(/Sugerido: el último proveedor/)).toBeInTheDocument();
    expect(screen.getByLabelText('Agregar otro insumo (opcional)')).toBeInTheDocument();
  });

  it('el buscador muestra todos al tocarlo y encuentra con errores («anestecia»)', async () => {
    simularApi({ 'GET /proveedores': { body: proveedores }, 'GET /insumos': { body: insumos } });
    renderizar(<NuevoPedido />);
    const u = userEvent.setup();
    const campo = await screen.findByLabelText('Agregar insumo');
    await waitFor(() => expect(screen.getByLabelText('Agregar insumo')).toBeEnabled());
    await u.click(campo);
    const lista = await screen.findByRole('listbox');
    await waitFor(() => expect(within(lista).getAllByRole('option')).toHaveLength(4));
    expect(within(lista).getAllByRole('option')[0]).toHaveTextContent('Guantes de nitrilo M ⚠ En mínimo');
    await u.type(campo, 'anestecia');
    expect(within(screen.getByRole('listbox')).getByText(/¿Quiso decir…\?/)).toBeInTheDocument();
    await u.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Anestesia lidocaína/ }));
    expect(screen.getByLabelText('Cantidad de Anestesia lidocaína 2 %')).toBeInTheDocument();
    expect(screen.getByText('Agregado')).toBeInTheDocument();
  });
});

describe('Modo oscuro', () => {
  it('el botón 🌙 cambia el tema y lo recuerda', async () => {
    simularApi({ 'GET /auth/yo': { body: { id: 1, nombres: 'Carlos Vega', email: 'carlos.vega@clinica.local', rol: 'administrador', pacienteId: null, odontologoId: null } } });
    renderizar(<AuthProvider><MenuPorRol /></AuthProvider>);
    const u = userEvent.setup();
    document.documentElement.setAttribute('data-bs-theme', 'light');
    await u.click(await screen.findByRole('button', { name: 'Cambiar a modo oscuro' }));
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(localStorage.getItem('clinica-tema')).toBe('oscuro');
    await u.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }));
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });
});

describe('Piezas de interacción', () => {
  it('campo de dígitos: ✓ al completar, ✗ con cuántos faltan al salir incompleto', async () => {
    function Prueba() {
      const [v, setV] = useState('');
      return (<><label htmlFor="d">DNI</label><CampoDigitos id="d" value={v} onChange={setV} largo={8} /><button>otro</button></>);
    }
    renderizar(<Prueba />);
    const u = userEvent.setup();
    const campo = screen.getByLabelText('DNI');
    await u.type(campo, '7245a');
    await u.click(screen.getByRole('button', { name: 'otro' }));
    expect(campo).toHaveClass('is-invalid');
    expect(screen.getByText('Faltan 4 dígito(s) (son 8)')).toBeInTheDocument();
    await u.type(campo, '8190');
    expect(campo).toHaveValue('72458190');
    expect(campo).toHaveClass('is-valid');
  });

  it('copiar: guarda en el portapapeles y avisa «¡Copiado!»', async () => {
    const u = userEvent.setup();
    const escribir = vi.spyOn(navigator.clipboard, 'writeText');
    renderizar(<BotonCopiar texto="987799567" etiqueta="el número" />);
    await u.click(screen.getByRole('button', { name: 'Copiar el número' }));
    expect(escribir).toHaveBeenCalledWith('987799567');
    expect(await screen.findByText('¡Copiado!')).toBeInTheDocument();
  });

  it('botón que trabaja: circulito mientras guarda, ✓ al terminar', () => {
    const { rerender } = renderizar(<BotonAccion mutacion={{ isPending: true, isSuccess: false, submittedAt: 1 }}>Guardar</BotonAccion>);
    expect(screen.getByRole('button')).toHaveTextContent('Guardando…');
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<BotonAccion mutacion={{ isPending: false, isSuccess: true, submittedAt: 1 }}>Guardar</BotonAccion>);
    expect(screen.getByRole('button')).toHaveTextContent('✓ Listo');
  });
});
