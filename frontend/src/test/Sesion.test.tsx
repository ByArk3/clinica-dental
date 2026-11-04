// Cerrar sesión y sesión vencida: vuelve al login sin recargar la página
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth';
import { Rutas } from '../routes';
import { renderizar, simularApi } from './utils';

const admin = { id: 1, nombres: 'Carlos Vega', email: 'carlos.vega@clinica.local', rol: 'administrador', pacienteId: null, odontologoId: null };

describe('Sesión', () => {
  it('«Cerrar sesión» lleva al login de inmediato', async () => {
    const llamadas = simularApi({ 'GET /auth/yo': { body: admin }, 'POST /auth/logout': { status: 204 }, 'GET /usuarios': { body: [] } });
    renderizar(<AuthProvider><Rutas /></AuthProvider>, '/usuarios');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByText('Ingrese a su cuenta')).toBeInTheDocument();
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url === '/api/auth/logout')).toBe(true);
  });

  it('si la sesión vence (401), lleva al login', async () => {
    simularApi({ 'GET /auth/yo': { body: admin }, 'GET /usuarios': { status: 401, body: { codigo: 'NO_AUTENTICADO', mensaje: 'Sesión vencida' } } });
    renderizar(<AuthProvider><Rutas /></AuthProvider>, '/usuarios');
    await waitFor(() => expect(screen.getByText('Ingrese a su cuenta')).toBeInTheDocument());
  });
});
