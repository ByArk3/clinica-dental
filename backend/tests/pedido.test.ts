import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

const idInsumo = async (n: string) => (await prisma.insumo.findUniqueOrThrow({ where: { nombre: n } })).id;
const idProv = async (ruc = '20601234567') => (await prisma.proveedor.findUniqueOrThrow({ where: { ruc } })).id;
const stock = async (n: string) => (await prisma.insumo.findUniqueOrThrow({ where: { nombre: n } })).stockActual.toFixed(2);

async function nuevoPedido(admin: Awaited<ReturnType<typeof sesion>>) {
  const r = await admin.post('/api/pedidos').send({
    proveedorId: await idProv(),
    insumos: [{ insumoId: await idInsumo('Resina compuesta A2'), cantidad: 10 }, { insumoId: await idInsumo('Guantes de nitrilo M'), cantidad: 50 }],
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
}

describe('Proveedores CU-26..29', () => {
  it('CU-26/27: registra, lista y busca por RUC o razón social', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/proveedores').send({ ruc: '20111222333', razonSocial: 'Insumos Norte S.A.C.', email: 'VENTAS@norte.pe', telefono: '044123456' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ruc: '20111222333', email: 'ventas@norte.pe', activo: true });
    expect((await admin.get('/api/proveedores?q=norte')).body).toHaveLength(1);
    expect((await admin.get('/api/proveedores?q=2060')).body[0].razonSocial).toBe('Distribuidora Odontomed S.A.C.');
  });

  it('validaciones: RUC de 11 dígitos, RUC duplicado (409)', async () => {
    const admin = await sesion('administrador');
    const mal = await admin.post('/api/proveedores').send({ ruc: '123', razonSocial: 'X' });
    expect(mal.status).toBe(422);
    expect(mal.body.campos).toMatchObject({ ruc: 'El RUC debe tener 11 dígitos', razonSocial: 'Ingrese la razón social' });
    const dup = await admin.post('/api/proveedores').send({ ruc: '20601234567', razonSocial: 'Otro' });
    expect(dup.status).toBe(409);
    expect(dup.body.mensaje).toBe(MENSAJES.RUC_DUPLICADO);
  });

  it('CU-28 modifica; CU-29 no desactiva con pedidos pendientes, sí después', async () => {
    const admin = await sesion('administrador');
    const id = await idProv();
    expect((await admin.patch(`/api/proveedores/${id}`).send({ ruc: '20601234567', razonSocial: 'Odontomed S.A.C.', contacto: 'Rosa' })).body).toMatchObject({ razonSocial: 'Odontomed S.A.C.', contacto: 'Rosa' });
    const p = await nuevoPedido(admin);
    const r = await admin.patch(`/api/proveedores/${id}/desactivar`);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.PROVEEDOR_CON_PEDIDOS);
    await admin.patch(`/api/pedidos/${p.id}/anular`).send({ motivo: 'Ya no se necesita' });
    expect((await admin.patch(`/api/proveedores/${id}/desactivar`)).body.activo).toBe(false);
    expect((await admin.get('/api/proveedores?activo=1')).body.map((x: { id: number }) => x.id)).not.toContain(id);
  });
});

describe('CU-30 Registrar pedido', () => {
  it('flujo básico: pedido «Pendiente» PED-0001 con sus insumos; el stock NO cambia', async () => {
    const admin = await sesion('administrador');
    const antes = await stock('Resina compuesta A2');
    const p = await nuevoPedido(admin);
    expect(p).toMatchObject({ codigo: 'PED-0001', estado: 'pendiente', registradoPor: 'Carlos Vega', proveedor: { ruc: '20601234567' } });
    expect(p.detalles.map((d: { insumo: string; cantidadPedida: string }) => [d.insumo, d.cantidadPedida])).toEqual([
      ['Resina compuesta A2', '10.00'],
      ['Guantes de nitrilo M', '50.00'],
    ]);
    expect(await stock('Resina compuesta A2')).toBe(antes);
    expect((await nuevoPedido(admin)).codigo).toBe('PED-0002');
  });

  it('8.1: sin insumos → «Agregue al menos un insumo»; cantidad ≤ 0 → 422', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/pedidos').send({ proveedorId: await idProv(), insumos: [] });
    expect(r.status).toBe(422);
    expect(r.body.campos.insumos).toBe(MENSAJES.SIN_INSUMOS_PEDIDO);
    const c = await admin.post('/api/pedidos').send({ proveedorId: await idProv(), insumos: [{ insumoId: await idInsumo('Copa de goma'), cantidad: 0 }] });
    expect(c.body.campos['insumos.0.cantidad']).toBe('La cantidad debe ser mayor que 0');
  });

  it('3.1: proveedor desactivado o inexistente → 422', async () => {
    const admin = await sesion('administrador');
    const id = await idProv('20487654321');
    await prisma.proveedor.update({ where: { id }, data: { activo: false } });
    for (const proveedorId of [id, 999]) {
      const r = await admin.post('/api/pedidos').send({ proveedorId, insumos: [{ insumoId: await idInsumo('Copa de goma'), cantidad: 5 }] });
      expect(r.status).toBe(422);
      expect(r.body.mensaje).toBe(MENSAJES.PROVEEDOR_INACTIVO);
    }
  });

  it('PDF del pedido y envío al proveedor (sin correo → 422)', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    const pdf = await admin.get(`/api/pedidos/${p.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const sinCorreo = await admin.post(`/api/pedidos/${p.id}/enviar`);
    expect(sinCorreo.status).toBe(422);
    expect(sinCorreo.body.mensaje).toBe(MENSAJES.PROVEEDOR_SIN_CORREO);
    await prisma.proveedor.update({ where: { id: p.proveedor.id }, data: { email: 'ventas@odontomed.pe' } });
    const ok = await admin.post(`/api/pedidos/${p.id}/enviar`);
    expect(ok.body.mensaje).toBe('Pedido enviado a ventas@odontomed.pe');
  });

  it('RN-13: solo el Administrador registra pedidos', async () => {
    for (const rol of ['recepcionista', 'odontologo'] as const) {
      expect((await (await sesion(rol)).post('/api/pedidos').send({})).status).toBe(403);
    }
  });
});

describe('CU-31 Listar / CU-32 Anular', () => {
  it('lista con filtro por estado; anula con motivo obligatorio y solo si está pendiente', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    expect((await admin.get('/api/pedidos?estado=pendiente')).body.pedidos).toHaveLength(1);
    const sin = await admin.patch(`/api/pedidos/${p.id}/anular`).send({ motivo: '' });
    expect(sin.status).toBe(422);
    expect(sin.body.campos.motivo).toBe('Indique el motivo de la anulación');
    const r = await admin.patch(`/api/pedidos/${p.id}/anular`).send({ motivo: 'Proveedor sin stock' });
    expect(r.body).toMatchObject({ estado: 'anulado', motivoAnulacion: 'Proveedor sin stock' });
    expect((await admin.patch(`/api/pedidos/${p.id}/anular`).send({ motivo: 'Otra vez' })).status).toBe(409);
    expect((await admin.get('/api/pedidos?estado=anulado')).body.pedidos).toHaveLength(1);
  });
});

describe('CU-33 Registrar recepción', () => {
  it('2.1: sin pedidos pendientes → mensaje', async () => {
    const admin = await sesion('administrador');
    const r = await admin.get('/api/pedidos?estado=pendiente');
    expect(r.body).toEqual({ pedidos: [], mensaje: MENSAJES.SIN_PEDIDOS_PENDIENTES });
  });

  it('flujo básico: todo lo pedido → «Recibido», suma al stock y registra entradas en el kárdex', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    const r = await admin.post(`/api/pedidos/${p.id}/recepcion`).send({
      verificado: true,
      items: p.detalles.map((d: { id: number; cantidadPedida: string }) => ({ detalleId: d.id, cantidadRecibida: d.cantidadPedida })),
    });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('recibido');
    expect(r.body.recibidoEn).not.toBeNull();
    expect(await stock('Resina compuesta A2')).toBe('15.00'); // 5 + 10
    expect(await stock('Guantes de nitrilo M')).toBe('57.00'); // 7 + 50
    const k = await prisma.movimientoKardex.findMany({ where: { referenciaTipo: 'pedido', referenciaId: p.id } });
    expect(k.map((m) => m.tipo)).toEqual(['entrada_recepcion', 'entrada_recepcion']);
  });

  it('RN-14: al reponer sobre el mínimo, la alerta abierta se cierra; si sigue bajo el mínimo, sigue abierta', async () => {
    const admin = await sesion('administrador');
    const resina = await idInsumo('Resina compuesta A2'); // 5, mín 5
    const guantes = await idInsumo('Guantes de nitrilo M'); // 7, mín 10
    // la semilla ya los deja con su alerta abierta (empiezan en el mínimo o por debajo)
    expect(await prisma.alertaStock.count({ where: { insumoId: { in: [resina, guantes] }, revisada: false } })).toBe(2);
    const p = await admin.post('/api/pedidos').send({ proveedorId: await idProv(), insumos: [{ insumoId: resina, cantidad: 10 }, { insumoId: guantes, cantidad: 2 }] });
    await admin.post(`/api/pedidos/${p.body.id}/recepcion`).send({ verificado: true, items: p.body.detalles.map((d: { id: number; cantidadPedida: string }) => ({ detalleId: d.id, cantidadRecibida: d.cantidadPedida })) });
    const pendientes = (await admin.get('/api/alertas')).body.map((a: { insumo: { nombre: string } }) => a.insumo.nombre);
    expect(pendientes).toEqual(['Guantes de nitrilo M']); // 9 ≤ 10: sigue en alerta
    const cerrada = (await admin.get('/api/alertas?todas=1')).body.find((a: { insumo: { nombre: string } }) => a.insumo.nombre === 'Resina compuesta A2');
    expect(cerrada).toMatchObject({ revisada: true, revisadaPor: 'Carlos Vega' });
  });

  it('6.1 / RN-15: con diferencias → observación obligatoria, «Recibido con diferencias», suma solo lo recibido', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    const [resina, guantes] = p.detalles;
    const items = [{ detalleId: resina.id, cantidadRecibida: 10 }, { detalleId: guantes.id, cantidadRecibida: 30 }];
    const sinObs = await admin.post(`/api/pedidos/${p.id}/recepcion`).send({ verificado: true, items });
    expect(sinObs.status).toBe(422);
    expect(sinObs.body.mensaje).toBe(MENSAJES.OBSERVACION_REQUERIDA);
    expect(await stock('Guantes de nitrilo M')).toBe('7.00'); // nada se aplicó

    const r = await admin.post(`/api/pedidos/${p.id}/recepcion`).send({ verificado: true, items, observacion: 'Faltaron 20 pares de guantes' });
    expect(r.body).toMatchObject({ estado: 'recibido_con_diferencias', observacionRecepcion: 'Faltaron 20 pares de guantes' });
    expect(r.body.detalles.map((d: { cantidadRecibida: string }) => d.cantidadRecibida)).toEqual(['10.00', '30.00']);
    expect(await stock('Guantes de nitrilo M')).toBe('37.00');
  });

  it('un insumo no llegó (0): no genera movimiento', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    const [resina, guantes] = p.detalles;
    await admin.post(`/api/pedidos/${p.id}/recepcion`).send({ verificado: true, items: [{ detalleId: resina.id, cantidadRecibida: 0 }, { detalleId: guantes.id, cantidadRecibida: 50 }], observacion: 'No llegó la resina' });
    expect(await prisma.movimientoKardex.count({ where: { referenciaTipo: 'pedido', insumoId: resina.insumoId } })).toBe(0);
    expect(await stock('Resina compuesta A2')).toBe('5.00');
  });

  it('RN-15: sin marcar «verifiqué» → 422; recepción incompleta → 422; pedido no pendiente → 409', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    const items = p.detalles.map((d: { id: number }) => ({ detalleId: d.id, cantidadRecibida: 1 }));
    const nv = await admin.post(`/api/pedidos/${p.id}/recepcion`).send({ verificado: false, items });
    expect(nv.status).toBe(422);
    expect(nv.body.campos.verificado).toBe(MENSAJES.VERIFICACION_REQUERIDA);
    const inc = await admin.post(`/api/pedidos/${p.id}/recepcion`).send({ verificado: true, items: items.slice(0, 1), observacion: 'x' });
    expect(inc.body.mensaje).toBe(MENSAJES.RECEPCION_INCOMPLETA);
    await admin.patch(`/api/pedidos/${p.id}/anular`).send({ motivo: 'Anulado por prueba' });
    expect((await admin.post(`/api/pedidos/${p.id}/recepcion`).send({ verificado: true, items, observacion: 'x' })).status).toBe(409);
  });

  it('dos recepciones simultáneas del mismo pedido → solo una suma al stock', async () => {
    const admin = await sesion('administrador');
    const p = await nuevoPedido(admin);
    const body = { verificado: true, items: p.detalles.map((d: { id: number; cantidadPedida: string }) => ({ detalleId: d.id, cantidadRecibida: d.cantidadPedida })) };
    const r = await Promise.all([1, 2].map(() => admin.post(`/api/pedidos/${p.id}/recepcion`).send(body)));
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(await stock('Resina compuesta A2')).toBe('15.00');
  });
});
