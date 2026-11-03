import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, crearCita, prisma, reiniciarBD } from './helpers.js';
import { enviarRecordatorios, liberarCitas } from '../src/jobs/citas.jobs.js';

beforeEach(reiniciarBD);

describe('CU-08 Confirmar cita — enlace', () => {
  it('flujo básico: abre el enlace, ve la cita y la confirma (sin iniciar sesión)', async () => {
    const c = await crearCita({ horas: 40, token: 'token-prueba-1234567890' });
    const ver = await request(app).get('/api/citas/confirmar/token-prueba-1234567890');
    expect(ver.status).toBe(200);
    expect(ver.body).toMatchObject({ paciente: 'María', odontologo: 'Dr. Luis Paredes', estado: 'pendiente_confirmacion', puedeResponder: true });
    expect(ver.body.dni).toBeUndefined(); // sin datos personales en el enlace público
    const r = await request(app).post('/api/citas/confirmar/token-prueba-1234567890').send({ accion: 'confirmar' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('confirmada');
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('confirmada');
  });

  it('alterno 4.1: elige Cancelar → «Cancelada» y el enlace ya no permite confirmar', async () => {
    await crearCita({ horas: 40, token: 'token-cancelar-123456' });
    const r = await request(app).post('/api/citas/confirmar/token-cancelar-123456').send({ accion: 'cancelar' });
    expect(r.body.estado).toBe('cancelada');
    const otra = await request(app).post('/api/citas/confirmar/token-cancelar-123456').send({ accion: 'confirmar' });
    expect(otra.status).toBe(409);
    expect(otra.body.mensaje).toBe(MENSAJES.CITA_YA_CANCELADA);
  });

  it('una cita confirmada todavía puede cancelarse por el enlace si faltan más de 24 h', async () => {
    await crearCita({ horas: 40, estado: 'confirmada', token: 'token-conf-cancel-1234' });
    const r = await request(app).post('/api/citas/confirmar/token-conf-cancel-1234').send({ accion: 'cancelar' });
    expect(r.body.estado).toBe('cancelada');
  });

  it('alterno 2.2: enlace abierto a menos de 24 h → «El plazo de confirmación venció…»', async () => {
    await crearCita({ horas: 10, token: 'token-vencido-1234567' });
    const ver = await request(app).get('/api/citas/confirmar/token-vencido-1234567');
    expect(ver.body).toMatchObject({ puedeResponder: false, mensaje: MENSAJES.PLAZO_VENCIDO });
    const r = await request(app).post('/api/citas/confirmar/token-vencido-1234567').send({ accion: 'confirmar' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.PLAZO_VENCIDO);
  });

  it('alterno 2.2: cita ya liberada → plazo vencido', async () => {
    await crearCita({ horas: 30, estado: 'liberada', token: 'token-liberada-123456' });
    const r = await request(app).post('/api/citas/confirmar/token-liberada-123456').send({ accion: 'confirmar' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.PLAZO_VENCIDO);
  });

  it('token inexistente → 404 «El enlace no es válido»', async () => {
    const r = await request(app).get('/api/citas/confirmar/no-existe-este-token');
    expect(r.status).toBe(404);
    expect(r.body.mensaje).toBe(MENSAJES.ENLACE_CITA_INVALIDO);
  });

  it('acción inválida → 422', async () => {
    await crearCita({ horas: 40, token: 'token-accion-12345678' });
    expect((await request(app).post('/api/citas/confirmar/token-accion-12345678').send({ accion: 'borrar' })).status).toBe(422);
  });
});

describe('Tareas programadas (sección 11)', () => {
  it('recordatorio: envía a las citas pendientes dentro de 48 h, una sola vez', async () => {
    const dentro = await crearCita({ horas: 40 });
    const lejos = await crearCita({ horas: 72, odontologoEmail: 'carmen.diaz@clinica.local' });
    const confirmada = await crearCita({ horas: 30, estado: 'confirmada', odontologoEmail: 'carmen.diaz@clinica.local' });
    const r = await enviarRecordatorios();
    expect(r).toEqual({ revisadas: 1, enviados: 1 });
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: dentro.id } })).recordatorioEnviadoEn).not.toBeNull();
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: lejos.id } })).recordatorioEnviadoEn).toBeNull();
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: confirmada.id } })).recordatorioEnviadoEn).toBeNull();
    expect(await enviarRecordatorios()).toEqual({ revisadas: 0, enviados: 0 }); // no se repite
  });

  it('recordatorio: paciente sin correo → se marca, sin enviar (lo envía la recepción por WhatsApp, P7)', async () => {
    await crearCita({ horas: 40, dni: '70112233' }); // Lucía no tiene correo
    expect(await enviarRecordatorios()).toEqual({ revisadas: 1, enviados: 0 });
  });

  it('alterno 2.1 / RN-04: sin confirmar a menos de 24 h → «Liberada»; las confirmadas no se tocan', async () => {
    const pendiente = await crearCita({ horas: 20 });
    const aTiempo = await crearCita({ horas: 30, odontologoEmail: 'carmen.diaz@clinica.local' });
    const confirmada = await crearCita({ horas: 10, estado: 'confirmada', odontologoEmail: 'carmen.diaz@clinica.local' });
    const liberadas = await liberarCitas();
    expect(liberadas).toEqual([pendiente.id]);
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: aTiempo.id } })).estado).toBe('pendiente_confirmacion');
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: confirmada.id } })).estado).toBe('confirmada');
  });

  it('las tareas respetan el instante recibido (simulación del paso del tiempo)', async () => {
    const c = await crearCita({ horas: 60 });
    expect(await liberarCitas()).toEqual([]);
    const enDosDias = new Date(Date.now() + 40 * 3_600_000);
    expect(await liberarCitas(enDosDias)).toEqual([c.id]);
  });
});
