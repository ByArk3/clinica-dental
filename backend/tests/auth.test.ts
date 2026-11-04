import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, PASSWORD, prisma, reiniciarBD, sesion, USUARIOS } from './helpers.js';
import { solicitarRecuperacion } from '../src/services/auth.service.js';

beforeEach(reiniciarBD);

describe('CU-01 Iniciar sesión', () => {
  it('flujo básico: inicia sesión, devuelve el rol y una cookie httpOnly de 15 min (RNF05)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: USUARIOS.recepcionista, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rol: 'recepcionista', nombres: 'Ana Ríos' });
    expect(r.body.password).toBeUndefined();
    const cookie = r.headers['set-cookie'][0];
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const expira = new Date(cookie.match(/Expires=([^;]+)/)![1]).getTime();
    expect(expira - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(expira - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it('alterno: contraseña incorrecta → 401 con mensaje genérico', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: USUARIOS.recepcionista, password: 'otraCosa1' });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ codigo: 'CREDENCIALES_INVALIDAS', mensaje: `${MENSAJES.CREDENCIALES_INVALIDAS}. Le quedan 2 intentos` });
  });

  it('alterno: usuario desactivado no puede ingresar', async () => {
    await prisma.usuario.update({ where: { email: USUARIOS.recepcionista }, data: { activo: false } });
    const r = await request(app).post('/api/auth/login').send({ email: USUARIOS.recepcionista, password: PASSWORD });
    expect(r.status).toBe(401);
  });

  it('cerrar sesión invalida la sesión', async () => {
    const agente = await sesion('recepcionista');
    expect((await agente.get('/api/auth/yo')).status).toBe(200);
    expect((await agente.post('/api/auth/logout')).status).toBe(204);
    const r = await agente.get('/api/auth/yo');
    expect(r.status).toBe(401);
    expect(r.body.mensaje).toBe(MENSAJES.NO_AUTENTICADO);
  });

  it('RNF07: la API rechaza un rol no autorizado con 403', async () => {
    const odontologo = await sesion('odontologo');
    const r = await odontologo.get('/api/pacientes?dni=72458190');
    expect(r.status).toBe(403);
    expect(r.body.mensaje).toBe(MENSAJES.SIN_PERMISO);
  });
});

describe('CU-02 Recuperar contraseña', () => {
  it('flujo básico: con el enlace se cambia la contraseña y se puede ingresar con la nueva', async () => {
    const token = await solicitarRecuperacion(USUARIOS.paciente);
    const r = await request(app).post('/api/auth/restablecer').send({ token, password: 'NuevaClave99' });
    expect(r.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: USUARIOS.paciente, password: 'NuevaClave99' });
    expect(login.status).toBe(200);
    // el enlace es de un solo uso
    const otra = await request(app).post('/api/auth/restablecer').send({ token, password: 'OtraClave99' });
    expect(otra.status).toBe(422);
  });

  it('responde igual aunque el correo no exista (no revela cuentas)', async () => {
    const a = await request(app).post('/api/auth/recuperar').send({ email: USUARIOS.paciente });
    const b = await request(app).post('/api/auth/recuperar').send({ email: 'nadie@correo.local' });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });

  it('alterno: enlace vencido (más de 30 min) → «enlace no válido»', async () => {
    const token = await solicitarRecuperacion(USUARIOS.paciente);
    await prisma.usuario.update({
      where: { email: USUARIOS.paciente },
      data: { resetTokenExpira: new Date(Date.now() - 1000) },
    });
    const r = await request(app).post('/api/auth/restablecer').send({ token, password: 'NuevaClave99' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.ENLACE_INVALIDO);
  });

  it('P16: rechaza contraseñas sin números o de menos de 8 caracteres', async () => {
    const token = await solicitarRecuperacion(USUARIOS.paciente);
    const r = await request(app).post('/api/auth/restablecer').send({ token, password: 'solotexto' });
    expect(r.status).toBe(422);
    expect(r.body.campos.password).toBe('La contraseña debe incluir números');
  });
});
