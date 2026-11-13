// Insumos: un solo botón «Modificar» con dos pestañas (datos del insumo · corregir stock)
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Insumos from '../pages/Insumos';
import { renderizar, simularApi } from './utils';

const guantes = { id: 3, nombre: 'Guantes de nitrilo M', unidad: 'par', stockActual: '48.00', stockMinimo: '10.00', activo: true };

describe('Insumos: Modificar con pestañas', () => {
  it('la tabla ya no tiene «Ajuste»; «Corregir stock» pide lo contado, muestra el resultado y envía la diferencia', async () => {
    const llamadas = simularApi({
      'GET /insumos': { body: [guantes] },
      'GET /alertas': { body: [] },
      'POST /insumos/3/ajuste': { status: 201, body: { saldo: '45.00', alertaGenerada: false, insumo: { ...guantes, stockActual: '45.00' } } },
    });
    renderizar(<Insumos />);
    const u = userEvent.setup();
    await screen.findAllByText('Guantes de nitrilo M');
    expect(screen.queryByRole('button', { name: 'Ajuste' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Modificar' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByRole('button', { name: 'Datos del insumo' })).toHaveClass('active');
    expect(within(modal).getByLabelText('Nombre')).toHaveValue('Guantes de nitrilo M');
    await u.click(within(modal).getByRole('button', { name: 'Corregir stock' }));
    await u.type(within(modal).getByLabelText('Cantidad contada (par)'), '45');
    expect(within(modal).getByText('-3')).toBeInTheDocument();
    await u.type(within(modal).getByLabelText(/^Motivo/), 'Conteo físico mensual');
    await u.click(within(modal).getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Stock de «Guantes de nitrilo M» corregido: 48 → 45 par');
    expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ tipo: 'ajuste', cantidad: -3, motivo: 'Conteo físico mensual' });
  });
});
