// Pendientes 21–25: «Mis datos» con confirmación, «Registrar atención» del odontólogo y odontograma entendible
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hoyEnLima, moverFecha } from '@clinica/shared';
import { FormContacto } from '../components/FormContacto';
import { PiezaDental } from '../components/PiezaDental';
import PorAtender from '../pages/PorAtender';
import { renderizar, simularApi } from './utils';
import type { Paciente } from '../api/recursos';

const maria = { id: 1, dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '949123456', email: 'maria@correo.local', direccion: null, apoderado: null, inasistencias: 0, restringido: false } as Paciente;

describe('«Mis datos»', () => {
  it('adulto: no ve el apoderado; marca obligatorios; sin cambios no guarda; pide «¿Guardar los cambios?» con Sí / No', async () => {
    const guardar = vi.fn(async () => {});
    renderizar(<FormContacto paciente={maria} onGuardar={guardar} />);
    const u = userEvent.setup();
    expect(screen.queryByLabelText(/apoderado/i)).toBeNull();
    expect(screen.getByText('Celular', { selector: 'label' })).toHaveClass('obligatorio');
    expect(screen.getByText('Correo', { selector: 'label' })).toHaveClass('obligatorio');
    expect(screen.getByText(/Dirección/, { selector: 'label' })).toHaveTextContent('(opcional)');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    const cel = screen.getByLabelText('Celular');
    await u.clear(cel);
    await u.type(cel, '987000111');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('¿Guardar los cambios?')).toBeInTheDocument();
    expect(screen.getByText('949123456')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'No' }));
    expect(guardar).not.toHaveBeenCalled();
    expect(cel).toHaveValue('987000111'); // lo escrito queda
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await u.click(await screen.findByRole('button', { name: 'Sí' }));
    await waitFor(() => expect(guardar).toHaveBeenCalledWith(expect.objectContaining({ telefono: '987000111', email: 'maria@correo.local' })));
    expect(await screen.findByText('Datos actualizados')).toBeInTheDocument();
  });

  it('el correo es obligatorio y se valida al salir del campo', async () => {
    renderizar(<FormContacto paciente={maria} onGuardar={async () => {}} />);
    const u = userEvent.setup();
    const correo = screen.getByLabelText('Correo');
    await u.clear(correo);
    await u.type(correo, 'sdsd23');
    expect(screen.queryByText('Correo inválido')).toBeNull();
    await u.tab();
    expect(screen.getByText('Correo inválido')).toBeInTheDocument();
  });

  it('menor: aparecen los 3 datos del apoderado y no puede dejarlos vacíos', async () => {
    const guardar = vi.fn(async () => {});
    renderizar(<FormContacto paciente={{ ...maria, fechaNacimiento: moverFecha(hoyEnLima(), { anios: -10 }), apoderado: 'Rosa Quispe', apoderadoDni: '40000004', apoderadoTelefono: '987000004' }} onGuardar={guardar} />);
    const u = userEvent.setup();
    await u.clear(screen.getByLabelText('Nombre del apoderado'));
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('Ingrese el nombre del apoderado')).toBeInTheDocument();
    expect(screen.queryByText('¿Guardar los cambios?')).toBeNull();
  });
});

describe('Odontólogo: «Registrar atención»', () => {
  it('lista solo los pacientes por atender hoy, con el siguiente destacado', async () => {
    const hoy = hoyEnLima();
    const base = { fecha: hoy, estado: 'confirmada', atencionId: null, paciente: { id: 1, dni: null, nombres: 'Ana', apellidos: 'Ruiz', fechaNacimiento: '2000-01-01', alergias: null } };
    simularApi({ 'GET /odontologos/me/citas': { body: [
      { ...base, id: 3, hora: '11:00', motivo: 'Limpieza', puedeAtender: true, paciente: { ...base.paciente, nombres: 'Luis' } },
      { ...base, id: 2, hora: '09:00', motivo: 'Consulta', puedeAtender: true },
      { ...base, id: 1, hora: '08:00', motivo: 'Dolor', puedeAtender: false, estado: 'atendida', atencionId: 7 },
    ] } });
    renderizar(<PorAtender />);
    const siguiente = await screen.findByTestId('siguiente-paciente');
    expect(siguiente).toHaveTextContent('09:00');
    expect(siguiente).toHaveTextContent('Ana Ruiz');
    expect(screen.getByRole('link', { name: 'Atender ahora' })).toHaveAttribute('href', `/atencion/registrar/2?fecha=${hoy}`);
    expect(screen.getAllByRole('link', { name: /^Atender/ })).toHaveLength(2);
    expect(screen.getByText(/2 por atender · 1 ya atendida/)).toBeInTheDocument();
  });
});

describe('Odontograma', () => {
  it('títulos por zona, nombre del diente y botón «Quitar pieza»', async () => {
    const cambiar = vi.fn();
    const { rerender } = renderizar(<PiezaDental valor={undefined} onCambiar={cambiar} />);
    expect(screen.getByText('Arriba · derecha del paciente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pieza 36' })).toHaveAttribute('title', '36 · primer molar inferior izquierdo');
    rerender(<PiezaDental valor="16" onCambiar={cambiar} />);
    expect(screen.getByText(/primer molar superior derecho/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '✕ Quitar pieza' }));
    expect(cambiar).toHaveBeenCalledWith(undefined);
  });

  it('menor de 12 años: muestra primero los dientes de leche; se puede cambiar a los de adulto', async () => {
    renderizar(<PiezaDental valor={undefined} edad={7} onCambiar={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pieza 54' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pieza 16' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ver dientes de adulto' }));
    expect(screen.getByRole('button', { name: 'Pieza 16' })).toBeInTheDocument();
  });
});
