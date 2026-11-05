// Interacción: buscador tolerante, pedido desde alertas, modo oscuro, campos de dígitos, copiar y botón que trabaja
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { buscar, puntaje } from '../buscar';
import NuevoPedido from '../pages/NuevoPedido';
import { BotonTema } from '../components/BotonTema';
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
    try { localStorage.setItem('clinica-tema', 'claro'); } catch { /* */ }
    document.documentElement.setAttribute('data-bs-theme', 'light');
    renderizar(<BotonTema />);
    const u = userEvent.setup();
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

describe('Quitar todos (Nuevo pedido)', () => {
  it('quita todos de golpe y «Deshacer» los devuelve con sus cantidades', async () => {
    const proveedores = [{ id: 1, ruc: '20601234567', razonSocial: 'Distribuidora Odontomed S.A.C.', contacto: null, telefono: null, email: null, activo: true }];
    simularApi({ 'GET /proveedores': { body: proveedores }, 'GET /insumos': { body: insumos }, 'GET /pedidos': { body: { pedidos: [] } } });
    renderizar(<Routes><Route path="/pedidos/nuevo" element={<NuevoPedido />} /></Routes>, '/pedidos/nuevo?insumos=3,4');
    const u = userEvent.setup();
    await screen.findByLabelText('Cantidad de Copa de goma');
    await u.clear(screen.getByLabelText('Cantidad de Copa de goma'));
    await u.type(screen.getByLabelText('Cantidad de Copa de goma'), '7');
    await u.click(screen.getByRole('button', { name: /Quitar todos/ }));
    expect(screen.queryByLabelText('Cantidad de Copa de goma')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Se quitaron 2 insumos del pedido');
    await u.click(screen.getByRole('button', { name: '↶ Deshacer' }));
    expect(screen.getByLabelText('Cantidad de Copa de goma')).toHaveValue('7');
    expect(screen.getByLabelText('Cantidad de Guantes de nitrilo M')).toBeInTheDocument();
  });
});

describe('Horarios: + Tramo con almuerzo y cruces', () => {
  it('propone 1 h después del último hasta el cierre; null si no hay espacio; detecta cruces', async () => {
    const { siguienteTramo, cruces } = await import('../pages/Configuracion');
    expect(siguienteTramo([{ diaSemana: 1, horaInicio: '08:00', horaFin: '14:00' }], 1)).toEqual({ diaSemana: 1, horaInicio: '15:00', horaFin: '20:00' });
    expect(siguienteTramo([{ diaSemana: 1, horaInicio: '08:00', horaFin: '19:00' }], 1)).toBeNull();
    expect(siguienteTramo([], 6)).toEqual({ diaSemana: 6, horaInicio: '08:00', horaFin: '14:00' });
    const c = cruces([{ diaSemana: 2, horaInicio: '08:00', horaFin: '14:00' }, { diaSemana: 2, horaInicio: '13:00', horaFin: '17:00' }, { diaSemana: 3, horaInicio: '13:00', horaFin: '17:00' }]);
    expect([...c.keys()].sort()).toEqual([0, 1]);
    expect(c.get(1)).toBe('13:00–17:00 se cruza con 08:00–14:00');
  });
});

describe('Horarios en pantalla', () => {
  it('«+ Tramo» agrega 15:00–20:00 tras 08:00–14:00; un cruce se avisa y no deja guardar', async () => {
    const { default: Configuracion } = await import('../pages/Configuracion');
    simularApi({
      'GET /admin/descuentos': { body: [] },
      'GET /odontologos': { body: [{ id: 1, nombres: 'Dr. Luis Paredes', especialidad: null }] },
      'GET /admin/odontologos/1/horario': { body: { odontologoId: 1, usaHorarioGeneral: false, tramos: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '14:00' }] } },
    });
    renderizar(<Configuracion />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Horarios de odontólogos' }));
    await screen.findByLabelText('Lunes desde');
    const filaLunes = screen.getByLabelText('Lunes desde').closest('.border-bottom') as HTMLElement;
    await u.click(within(filaLunes).getByRole('button', { name: '+ Tramo' }));
    expect(screen.getAllByLabelText('Lunes desde')[1]).toHaveValue('15:00');
    expect(screen.getAllByLabelText('Lunes hasta')[1]).toHaveValue('20:00');
    expect(within(filaLunes).getByText('🍽 Pausa 14:00–15:00')).toBeInTheDocument();
    expect(within(filaLunes).getByRole('button', { name: '+ Tramo' })).toBeDisabled(); // ya llega al cierre
    await u.selectOptions(screen.getAllByLabelText('Lunes desde')[1], '13:00');
    expect(within(filaLunes).getByRole('alert')).toHaveTextContent('se cruza con');
    expect(screen.getByRole('button', { name: 'Guardar horario' })).toBeDisabled();
  });
});
