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
