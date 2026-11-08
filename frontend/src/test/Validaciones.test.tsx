// Formulario del paciente: obligatorios marcados, nombres solo letras, apoderado para menores, ayuda de la contraseña
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { moverFecha, hoyEnLima } from '@clinica/shared';
import { FormPaciente } from '../components/FormPaciente';
import { renderizar } from './utils';

describe('Formulario de registro del paciente', () => {
  it('web: marca obligatorios y opcionales; nombres sin números ni símbolos; la ayuda de la contraseña dice solo el mínimo', async () => {
    renderizar(<FormPaciente conCuenta textoBoton="Crear cuenta" onEnviar={async () => {}} />);
    const u = userEvent.setup();
    for (const campo of ['DNI', 'Nombres', 'Apellidos', 'Fecha de nacimiento', 'Celular', 'Correo']) {
      expect(screen.getByText(campo, { selector: 'label' })).toHaveClass('obligatorio');
    }
    expect(screen.getByText('Sexo', { selector: 'label' })).toHaveClass('obligatorio');
    expect(screen.getByText(/Dirección/, { selector: 'label' })).toHaveTextContent('(opcional)');
    await u.type(screen.getByLabelText('Nombres'), 'Ana2 María#');
    expect(screen.getByLabelText('Nombres')).toHaveValue('Ana María');
    expect(screen.getByText('Mínimo 8 caracteres.')).toBeInTheDocument();
  });

  it('menor de 18: el apoderado pasa a ser obligatorio', async () => {
    renderizar(<FormPaciente textoBoton="Registrar paciente" onEnviar={async () => {}} />);
    const u = userEvent.setup();
    const etiqueta = () => screen.getByText(/Apoderado/, { selector: 'label' });
    expect(etiqueta()).toHaveTextContent('(opcional)');
    await u.type(screen.getByLabelText('Fecha de nacimiento'), moverFecha(hoyEnLima(), { anios: -8 }));
    expect(etiqueta()).toHaveClass('obligatorio');
    expect(screen.getByText(/Es menor de edad/)).toBeInTheDocument();
  });
});

describe('Caja: monto recibido en efectivo', () => {
  it('solo números con hasta 5 dígitos y 2 decimales', async () => {
    const { limpiarMonto } = await import('@clinica/shared');
    expect(limpiarMonto('sdsd125')).toBe('125');
    expect(limpiarMonto('1234567')).toBe('12345');
    expect(limpiarMonto('150,509')).toBe('150.50');
    expect(limpiarMonto('1.2.3')).toBe('1.23');
  });
});

describe('Confirmar contraseña', () => {
  it('nueva contraseña (recuperar): si no coinciden avisa y no envía; si coinciden se marca en verde', async () => {
    const { Restablecer } = await import('../pages/Recuperar');
    const { simularApi } = await import('./utils');
    const llamadas = simularApi({ 'POST /auth/restablecer': { body: { mensaje: 'Contraseña actualizada' } } });
    renderizar(<Restablecer />, '/restablecer?token=abcdefghijkl');
    const u = userEvent.setup();
    expect(screen.getByText('Mínimo 8 caracteres.')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Contraseña nueva'), 'Dientes2027');
    await u.type(screen.getByLabelText('Confirmar contraseña'), 'Dientes2028');
    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(llamadas).toHaveLength(0);
    await u.clear(screen.getByLabelText('Confirmar contraseña'));
    await u.type(screen.getByLabelText('Confirmar contraseña'), 'Dientes2027');
    expect(screen.getByLabelText('Confirmar contraseña')).toHaveClass('is-valid');
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Contraseña actualizada')).toBeInTheDocument();
  });

  it('registro web: pide confirmar la contraseña', async () => {
    renderizar(<FormPaciente conCuenta textoBoton="Crear cuenta" onEnviar={async () => {}} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Contraseña'), 'Dientes2027');
    await u.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument();
  });
});

describe('Reglas de escritura en pantalla', () => {
  it('Tarifario: títulos «Insumo / Cantidad», unidad al lado y solo números en precio y cantidad', async () => {
    const { default: Tarifario } = await import('../pages/Tarifario');
    const { simularApi } = await import('./utils');
    simularApi({
      'GET /tratamientos': { body: [{ id: 1, nombre: 'Aplicación de flúor', precio: '40.00', activo: true, insumos: [{ insumoId: 8, insumo: 'Barniz de flúor', unidad: 'dosis', cantidad: '1.00' }] }] },
      'GET /insumos': { body: [{ id: 8, nombre: 'Barniz de flúor', unidad: 'dosis', stockActual: '30', stockMinimo: '10', activo: true }] },
    });
    renderizar(<Tarifario />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Modificar' }));
    const precio = await screen.findByLabelText('Precio (S/)');
    await u.clear(precio);
    await u.type(precio, '40 sdsd');
    expect(precio).toHaveValue('40');
    expect(screen.getByText('Insumo')).toBeInTheDocument();
    expect(screen.getByText('Cantidad')).toBeInTheDocument();
    expect(screen.getByText('dosis')).toBeInTheDocument();
    const cant = screen.getByLabelText('Cantidad 1');
    await u.type(cant, 'abc');
    expect(cant).not.toHaveValue(expect.stringMatching(/[a-z]/));
  });
});
