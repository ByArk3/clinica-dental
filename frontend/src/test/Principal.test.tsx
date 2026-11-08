// RN-23 Administrador principal en la pantalla Usuarios
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Usuarios from '../pages/Usuarios';
import { AuthProvider } from '../auth';
import { renderizar, simularApi } from './utils';

const base = { activo: true, cmp: null, especialidad: null, dni: null, bloqueadoHasta: null };
const carlos = { ...base, id: 1, nombres: 'Carlos Vega', email: 'carlos.vega@clinica.local', rol: 'administrador', principal: true };
const probando = { ...base, id: 9, nombres: 'Probando Admin', email: 'probando@clinica.local', rol: 'administrador', principal: false };
const ana = { ...base, id: 2, nombres: 'Ana Ríos', email: 'ana.rios@clinica.local', rol: 'recepcionista', principal: false };
const sesion = (u: typeof carlos) => ({ body: { id: u.id, nombres: u.nombres, email: u.email, rol: 'administrador', pacienteId: null, odontologoId: null } });
const fila = async (nombre: string) => (await screen.findAllByText(nombre)).map((x) => x.closest('tr')).find(Boolean) as HTMLElement;

describe('Usuarios: administrador principal', () => {
  it('otro administrador ve al principal protegido y no puede gestionar administradores', async () => {
    simularApi({ 'GET /auth/yo': sesion(probando), 'GET /usuarios': { body: [carlos, probando, ana] } });
    renderizar(<AuthProvider><Usuarios /></AuthProvider>);
    const fCarlos = await fila('Carlos Vega');
    expect(within(fCarlos).getByText('★ Principal')).toBeInTheDocument();
    expect(within(fCarlos).queryByRole('button', { name: 'Desactivar' })).toBeNull();
    expect(within(fCarlos).queryByRole('button', { name: 'Modificar' })).toBeNull();
    expect(within(fCarlos).getByText(/Protegido/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Carlos Vega es el administrador principal');
    // al resto del personal sí lo gestiona
    expect(within(await fila('Ana Ríos')).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
  });

  it('el principal traspasa su papel confirmando con su contraseña', async () => {
    const llamadas = simularApi({
      'GET /auth/yo': sesion(carlos),
      'GET /usuarios': { body: [carlos, probando, ana] },
      'POST /usuarios/9/principal': { body: { ...probando, principal: true } },
    });
    renderizar(<AuthProvider><Usuarios /></AuthProvider>);
    const u = userEvent.setup();
    const fProbando = await fila('Probando Admin');
    expect(within(await fila('Ana Ríos')).queryByRole('button', { name: /Hacer principal/ })).toBeNull();
    await u.click(within(fProbando).getByRole('button', { name: /Hacer principal/ }));
    const modal = await screen.findByRole('dialog');
    await u.type(within(modal).getByLabelText('Confirme con su contraseña'), 'Clinica2026');
    await u.click(within(modal).getByRole('button', { name: 'Traspasar' }));
    await waitFor(() => expect(llamadas.find((l) => l.metodo === 'POST')?.body).toEqual({ password: 'Clinica2026' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Probando Admin es ahora el administrador principal');
  });
});
