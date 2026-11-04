// Autocompletar nombres con el DNI (RENIEC, por un proveedor intermedio). Se simula el proveedor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reiniciarBD, sesion } from './helpers.js';
import { nombrePropio } from '../src/services/reniec.service.js';

beforeEach(reiniciarBD);
afterEach(() => {
  delete process.env.RENIEC_TOKEN;
  delete process.env.RENIEC_URL;
  vi.restoreAllMocks();
});

const proveedor = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('Autocompletar con RENIEC', () => {
  it('sin token configurado no consulta nada (la recepcionista escribe los datos)', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const r = await (await sesion('recepcionista')).get('/api/reniec/45678912');
    expect(r.body).toEqual({ encontrado: false, motivo: 'no_configurado' });
    expect(f).not.toHaveBeenCalled();
  });

  it('con token: devuelve nombres y apellidos en formato de nombre propio (respuesta tipo Decolecta)', async () => {
    process.env.RENIEC_TOKEN = 'token-de-prueba';
    const f = proveedor(200, { first_name: 'JUAN CARLOS', first_last_name: 'DE LA CRUZ', second_last_name: 'QUISPE', document_number: '45678912' });
    const r = await (await sesion('recepcionista')).get('/api/reniec/45678912');
    expect(r.body).toEqual({ encontrado: true, nombres: 'Juan Carlos', apellidos: 'De la Cruz Quispe' });
    const [url, opciones] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.decolecta.com/v1/reniec/dni?numero=45678912');
    expect((opciones.headers as Record<string, string>).Authorization).toBe('Bearer token-de-prueba');
  });

  it('acepta la respuesta de otros proveedores (nombres / apellidoPaterno / apellidoMaterno) y una URL propia', async () => {
    process.env.RENIEC_TOKEN = 't';
    process.env.RENIEC_URL = 'https://otro.proveedor.pe/dni/{dni}';
    const f = proveedor(200, { data: { nombres: 'ROSA', apellido_paterno: 'HUAMAN', apellido_materno: 'LOPEZ' } });
    expect((await (await sesion('recepcionista')).get('/api/reniec/45678912')).body).toEqual({ encontrado: true, nombres: 'Rosa', apellidos: 'Huaman Lopez' });
    expect(f.mock.calls[0][0]).toBe('https://otro.proveedor.pe/dni/45678912');
  });

  it.each([
    [404, 'no_encontrado', {}],
    [401, 'no_disponible', { message: 'token inválido' }],
    [429, 'no_disponible', { message: 'sin consultas' }],
  ])('proveedor responde %i → %s (no se cae el registro)', async (status, motivo, body) => {
    process.env.RENIEC_TOKEN = 't';
    proveedor(status, body);
    expect((await (await sesion('recepcionista')).get('/api/reniec/45678912')).body).toEqual({ encontrado: false, motivo });
  });

  it('proveedor caído o lento → no disponible', async () => {
    process.env.RENIEC_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    expect((await (await sesion('recepcionista')).get('/api/reniec/45678912')).body.motivo).toBe('no_disponible');
  });

  it('valida el DNI y solo la recepcionista lo usa', async () => {
    expect((await (await sesion('recepcionista')).get('/api/reniec/123')).status).toBe(422);
    expect((await (await sesion('paciente')).get('/api/reniec/45678912')).status).toBe(403);
  });

  it('nombre propio', () => {
    expect(nombrePropio('  MARÍA DEL PILAR  ')).toBe('María del Pilar');
  });
});
