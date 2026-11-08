// Billeteras aceptadas (hoy solo Yape) y QR de pago de la clínica
import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

// PNG de 1×1 (QR de ejemplo, sin datos reales)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Billeteras aceptadas', () => {
  it('por defecto solo Yape: el tipo de pago de caja se llama «Yape» y no se acepta un pago reportado por Plin', async () => {
    const recep = await sesion('recepcionista');
    expect((await recep.get('/api/tipos-pago')).body.map((t: { nombre: string }) => t.nombre)).toEqual(['Efectivo', 'Tarjeta', 'Yape']);
    const cita = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 50 });
    const pac = await sesion('paciente');
    const plin = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'plin', numeroOperacion: 'IBK123456789' });
    expect(plin.status).toBe(422);
    expect(plin.body.mensaje).toBe(MENSAJES.BILLETERA_NO_ACEPTADA);
    expect((await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: '123456' })).body.estado).toBe('pago_en_verificacion');
  });

  it('al activar Plin, el tipo de pago pasa a «Yape/Plin» (el mismo registro) y se acepta', async () => {
    const admin = await sesion('administrador');
    const antes = await prisma.tipoPago.findFirstOrThrow({ where: { nombre: 'Yape' } });
    const r = await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica Dental', billeteras: ['plin', 'yape'] });
    expect(r.body.billeteras).toEqual(['yape', 'plin']);
    expect((await prisma.tipoPago.findUniqueOrThrow({ where: { id: antes.id } })).nombre).toBe('Yape/Plin');
    expect(await prisma.tipoPago.count()).toBe(4); // + «Saldo a favor»
    const cita = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 50 });
    expect((await (await sesion('paciente')).post(`/api/citas/${cita.id}/pago`).send({ metodo: 'plin', numeroOperacion: 'bbva6543210987' })).status).toBe(200);
    // la semilla no lo duplica al volver a correr
    const { sembrar } = await import('../prisma/seed.js');
    await sembrar(prisma, { silencioso: true, horariosEjemplo: false, campanas: false, feriados: false });
    expect(await prisma.tipoPago.count()).toBe(4);
  });

  it('debe quedar al menos una billetera', async () => {
    const admin = await sesion('administrador');
    const r = await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica Dental', billeteras: [] });
    expect(r.status).toBe(422);
    expect(r.body.campos.billeteras).toBe('Marque al menos una billetera');
  });
});

describe('QR de pago', () => {
  it('el Administrador lo sube; el paciente lo ve; se puede quitar', async () => {
    const admin = await sesion('administrador');
    const pac = await sesion('paciente');
    expect((await pac.get('/api/datos-pago/qr')).status).toBe(404);
    const r = await admin.put('/api/admin/pago/qr').send({ qr: PNG });
    expect(r.status).toBe(200);
    expect(r.body.tieneQr).toBe(true);
    expect((await pac.get('/api/datos-pago')).body).toMatchObject({ numero: '987654321', billeteras: ['yape'], tieneQr: true });
    const img = await pac.get('/api/datos-pago/qr');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.body.subarray(1, 4).toString()).toBe('PNG');
    expect((await admin.delete('/api/admin/pago/qr')).body.tieneQr).toBe(false);
    expect((await pac.get('/api/datos-pago/qr')).status).toBe(404);
  });

  it('valida el formato y el tamaño; solo el Administrador lo cambia', async () => {
    const admin = await sesion('administrador');
    const txt = await admin.put('/api/admin/pago/qr').send({ qr: 'data:text/plain;base64,aG9sYQ==' });
    expect(txt.body.campos.qr).toBe('El QR debe ser una imagen PNG, JPG o WEBP');
    const grande = `data:image/png;base64,${'A'.repeat(2_900_000)}`;
    expect((await admin.put('/api/admin/pago/qr').send({ qr: grande })).body.campos.qr).toBe('El QR no debe pasar de 2 MB');
    expect((await (await sesion('recepcionista')).put('/api/admin/pago/qr').send({ qr: PNG })).status).toBe(403);
  });
});

describe('Número de operación según la billetera', () => {
  it('Yape: solo números, máximo 8; Plin: letras y números de 12 a 20 (se guarda en mayúsculas)', async () => {
    const admin = await sesion('administrador');
    await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica Dental', billeteras: ['yape', 'plin'] });
    const pac = await sesion('paciente');
    const cita = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 40 });
    const campo = async (metodo: string, numeroOperacion: string) => (await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo, numeroOperacion })).body.campos?.numeroOperacion;
    expect(await campo('yape', '123456789')).toBe('El número de operación de Yape tiene como máximo 8 dígitos');
    expect(await campo('yape', '12AB5678')).toBe('El número de operación de Yape tiene solo números');
    expect(await campo('plin', '12345678')).toBe('El código de operación de Plin tiene de 12 a 20 caracteres');
    expect(await campo('plin', 'ABC-12345678')).toBe('El número de operación tiene solo letras y números');
    const ok = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'plin', numeroOperacion: 'ibk123456789' });
    expect(ok.status).toBe(200);
    expect(ok.body.pagoReportado.numeroOperacion).toBe('IBK123456789');
  });
});
