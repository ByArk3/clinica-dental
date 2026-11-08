// Reglas de escritura: números donde van números, letras donde van letras (la API valida lo mismo que la pantalla)
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

describe('Reglas de escritura en la API', () => {
  it('tarifario: precio y cantidades solo números (hasta 5 dígitos y 2 decimales)', async () => {
    const admin = await sesion('administrador');
    const guantes = (await prisma.insumo.findFirstOrThrow({ where: { nombre: { startsWith: 'Guantes' } } })).id;
    const mal = await admin.post('/api/tratamientos').send({ nombre: 'Prueba', precio: '40 sdsd', insumos: [{ insumoId: guantes, cantidad: '1 sdsd' }] });
    expect(mal.status).toBe(422);
    expect(Object.keys(mal.body.campos)).toEqual(expect.arrayContaining(['precio', 'insumos.0.cantidad']));
    expect((await admin.post('/api/tratamientos').send({ nombre: 'Prueba', precio: 100000, insumos: [] })).body.campos.precio).toBe('Máximo 5 dígitos');
    expect((await admin.post('/api/tratamientos').send({ nombre: 'Sellante doble', precio: 70.5, insumos: [{ insumoId: guantes, cantidad: 0.25 }] })).status).toBe(201);
  });

  it('insumos: la unidad lleva solo letras y el stock solo números', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/insumos').send({ nombre: 'Algodón', unidad: 'caja2', stockMinimo: 'abc', stockInicial: 10 });
    expect(r.body.campos).toMatchObject({ unidad: 'La unidad lleva solo letras', stockMinimo: 'Ingrese un número' });
  });

  it('usuarios: nombre del personal con letras y punto («Dr.»); especialidad solo letras', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/usuarios').send({ nombres: 'Dr. Juan 2', email: 'juan@clinica.local', rol: 'odontologo', especialidad: 'Endo#', password: 'Segura2026' });
    expect(Object.keys(r.body.campos)).toEqual(expect.arrayContaining(['nombres', 'especialidad']));
    expect((await admin.post('/api/usuarios').send({ nombres: 'Mg. C.D. Juana Pérez-Ruiz', email: 'juana@clinica.local', rol: 'odontologo', especialidad: 'Ortodoncia', password: 'Segura2026' })).status).toBe(201);
  });

  it('proveedores: el contacto lleva solo letras; titular de Yape: letras, números y «. & - ( )»', async () => {
    const admin = await sesion('administrador');
    expect((await admin.post('/api/proveedores').send({ ruc: '20123456789', razonSocial: 'Dental Norte S.A.C.', contacto: 'Luis 123' })).body.campos.contacto).toBe('El contacto lleva solo letras');
    expect((await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica <b>', billeteras: ['yape'] })).status).toBe(422);
    expect((await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica Dental S.A.C. (Trujillo)', billeteras: ['yape'] })).status).toBe(200);
  });
});
