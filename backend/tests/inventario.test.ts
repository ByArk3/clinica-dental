import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

const idInsumo = async (nombre: string) => (await prisma.insumo.findUniqueOrThrow({ where: { nombre } })).id;
const idTrat = async (nombre: string) => (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre } })).id;

describe('Tarifario CU-14..17', () => {
  it('CU-15 lista con insumos y busca por nombre; filtra por estado', async () => {
    const admin = await sesion('administrador');
    const r = await admin.get('/api/tratamientos?q=resina');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ nombre: 'Curación con resina', precio: '120.00', activo: true });
    expect(r.body[0].insumos.map((i: { nombre: string }) => i.nombre).sort()).toEqual(['Anestesia lidocaína 2 %', 'Guantes de nitrilo M', 'Resina compuesta A2']);
    await admin.patch(`/api/tratamientos/${await idTrat('Consulta')}/desactivar`);
    const inactivos = await admin.get('/api/tratamientos?activo=0');
    expect(inactivos.body.map((t: { nombre: string }) => t.nombre)).toEqual(['Consulta']);
  });

  it('CU-14 agrega un tratamiento con sus insumos', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/tratamientos').send({
      nombre: 'Sellante de fosas',
      precio: '65.50',
      insumos: [{ insumoId: await idInsumo('Guantes de nitrilo M'), cantidad: 1 }, { insumoId: await idInsumo('Resina compuesta A2'), cantidad: '0.5' }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ nombre: 'Sellante de fosas', precio: '65.50' });
    expect(r.body.insumos).toHaveLength(2);
  });

  it('CU-14 validaciones: nombre duplicado (409), precio ≤ 0, insumo repetido, cantidad ≤ 0 (422)', async () => {
    const admin = await sesion('administrador');
    const dup = await admin.post('/api/tratamientos').send({ nombre: 'Profilaxis', precio: 10, insumos: [] });
    expect(dup.status).toBe(409);
    expect(dup.body.mensaje).toBe(MENSAJES.TRATAMIENTO_DUPLICADO);
    const g = await idInsumo('Guantes de nitrilo M');
    const mal = await admin.post('/api/tratamientos').send({ nombre: 'X1', precio: 0, insumos: [{ insumoId: g, cantidad: 0 }] });
    expect(mal.status).toBe(422);
    expect(mal.body.campos).toMatchObject({ precio: 'El precio debe ser mayor que 0', 'insumos.0.cantidad': 'La cantidad debe ser mayor que 0' });
    const rep = await admin.post('/api/tratamientos').send({ nombre: 'X2', precio: 10, insumos: [{ insumoId: g, cantidad: 1 }, { insumoId: g, cantidad: 2 }] });
    expect(rep.body.campos.insumos).toBe('Un insumo aparece dos veces');
    const dec = await admin.post('/api/tratamientos').send({ nombre: 'X3', precio: 10.555, insumos: [] });
    expect(dec.body.campos.precio).toBe('Máximo 2 decimales');
  });

  it('CU-14 no acepta insumos desactivados', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Gasa estéril');
    await prisma.insumo.update({ where: { id }, data: { activo: false } });
    const r = await admin.post('/api/tratamientos').send({ nombre: 'Nuevo', precio: 10, insumos: [{ insumoId: id, cantidad: 1 }] });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.INSUMO_INACTIVO);
  });

  it('CU-16 modifica precio e insumos (reemplaza la receta)', async () => {
    const admin = await sesion('administrador');
    const id = await idTrat('Profilaxis');
    const r = await admin.patch(`/api/tratamientos/${id}`).send({ nombre: 'Profilaxis', precio: 90, insumos: [{ insumoId: await idInsumo('Copa de goma'), cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(r.body.precio).toBe('90.00');
    expect(r.body.insumos).toEqual([expect.objectContaining({ nombre: 'Copa de goma', cantidad: '2.00' })]);
  });

  it('CU-17 desactivar / reactivar; inexistente → 404', async () => {
    const admin = await sesion('administrador');
    const id = await idTrat('Blanqueamiento');
    expect((await admin.patch(`/api/tratamientos/${id}/desactivar`)).body.activo).toBe(false);
    expect((await admin.patch(`/api/tratamientos/${id}/activar`)).body.activo).toBe(true);
    expect((await admin.patch('/api/tratamientos/9999/desactivar')).status).toBe(404);
  });

  it('RNF07: el odontólogo solo LEE el tarifario activo; recepcionista y paciente no acceden', async () => {
    await prisma.tratamiento.update({ where: { nombre: 'Consulta' }, data: { activo: false } });
    const od = await sesion('odontologo');
    const r = await od.get('/api/tratamientos?activo=0');
    expect(r.body.map((t: { nombre: string }) => t.nombre)).not.toContain('Consulta');
    expect((await od.post('/api/tratamientos').send({ nombre: 'Y', precio: 1, insumos: [] })).status).toBe(403);
    expect((await (await sesion('recepcionista')).get('/api/tratamientos')).status).toBe(403);
  });
});

describe('Insumos CU-18..22', () => {
  it('CU-18 registra un insumo con su stock inicial en el kárdex', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/insumos').send({ nombre: 'Hilo de sutura', unidad: 'sobre', stockMinimo: 3, stockInicial: 10 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ stockActual: '10.00', stockMinimo: '3.00', bajoMinimo: false });
    const k = await admin.get(`/api/insumos/${r.body.id}/kardex`);
    expect(k.body.movimientos).toEqual([expect.objectContaining({ tipo: 'inicial', cantidad: '10.00', saldo: '10.00', usuario: 'Carlos Vega' })]);
  });

  it('CU-18 con stock inicial por debajo del mínimo genera alerta', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/insumos').send({ nombre: 'Algodón', unidad: 'rollo', stockMinimo: 5, stockInicial: 2 });
    expect(r.body.bajoMinimo).toBe(true);
    const a = await admin.get('/api/alertas');
    expect(a.body.map((x: { insumo: { nombre: string } }) => x.insumo.nombre)).toContain('Algodón');
  });

  it('CU-18 nombre duplicado → 409; negativos → 422', async () => {
    const admin = await sesion('administrador');
    expect((await admin.post('/api/insumos').send({ nombre: 'Copa de goma', unidad: 'u', stockMinimo: 1, stockInicial: 1 })).status).toBe(409);
    const r = await admin.post('/api/insumos').send({ nombre: 'Z', unidad: '', stockMinimo: -1, stockInicial: -2 });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.campos)).toEqual(expect.arrayContaining(['nombre', 'unidad', 'stockMinimo', 'stockInicial']));
  });

  it('CU-19 lista y filtra por bajo mínimo; CU-22 busca solo activos', async () => {
    const admin = await sesion('administrador');
    const bajos = await admin.get('/api/insumos?bajoMinimo=1');
    expect(bajos.body.map((i: { nombre: string }) => i.nombre).sort()).toEqual(['Guantes de nitrilo M', 'Resina compuesta A2']);
    await prisma.insumo.update({ where: { nombre: 'Gasa estéril' }, data: { activo: false } });
    const b = await admin.get('/api/insumos/buscar?q=gasa');
    expect(b.body).toEqual([]);
    expect((await admin.get('/api/insumos?q=gasa')).body).toHaveLength(1);
  });

  it('CU-20 modifica nombre, unidad y mínimo, pero NO el stock actual', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Copa de goma');
    const r = await admin.patch(`/api/insumos/${id}`).send({ nombre: 'Copa de goma blanda', unidad: 'unidad', stockMinimo: 8, stockActual: 999 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nombre: 'Copa de goma blanda', stockMinimo: '8.00', stockActual: '12.00' });
  });

  it('CU-21 no desactiva un insumo usado por un tratamiento activo; sí si el tratamiento está inactivo', async () => {
    const admin = await sesion('administrador');
    const gel = await idInsumo('Gel blanqueador'); // solo lo usa Blanqueamiento
    const r = await admin.patch(`/api/insumos/${gel}/desactivar`);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(`${MENSAJES.INSUMO_EN_USO} (Blanqueamiento)`);
    await admin.patch(`/api/tratamientos/${await idTrat('Blanqueamiento')}/desactivar`);
    expect((await admin.patch(`/api/insumos/${gel}/desactivar`)).body.activo).toBe(false);
    // y el tratamiento no puede reactivarse mientras su insumo esté inactivo
    const re = await admin.patch(`/api/tratamientos/${await idTrat('Blanqueamiento')}/activar`);
    expect(re.status).toBe(422);
  });

  it('RN-13 / RNF07: solo el administrador gestiona insumos', async () => {
    for (const rol of ['odontologo', 'recepcionista', 'paciente'] as const) {
      expect((await (await sesion(rol)).get('/api/insumos')).status).toBe(403);
    }
  });
});
