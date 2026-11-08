// Registro y corrección de pacientes: nombres solo letras, sexo obligatorio, apoderado para menores, contraseña del paciente
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJE_APODERADO } from '@clinica/shared';
import { app, idPaciente, prisma, reiniciarBD, sesion } from './helpers.js';
import { ahoraLima, sumarDias } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);
const web = { dni: '45678912', nombres: 'Elena', apellidos: 'Mendoza Ruiz', fechaNacimiento: '1992-07-19', telefono: '987654321', sexo: 'femenino', email: 'elena.m@correo.local', password: 'Sonrisa2026' };
const hace = (anios: number) => sumarDias(ahoraLima().fecha, -Math.round(anios * 365.25));

describe('Registro web del paciente', () => {
  it('nombres y apellidos solo letras (con tildes, ñ, apóstrofo y guion)', async () => {
    const mal = await request(app).post('/api/auth/registro-paciente').send({ ...web, nombres: 'Elena2', apellidos: 'Ruiz#' });
    expect(mal.body.campos).toMatchObject({ nombres: 'Solo letras (sin números ni símbolos)', apellidos: 'Solo letras (sin números ni símbolos)' });
    expect((await request(app).post('/api/auth/registro-paciente').send({ ...web, nombres: 'María José', apellidos: "D'Ángelo Peña-Núñez" })).status).toBe(201);
  });

  it('obligatorios: sexo y correo', async () => {
    const { sexo: _s, email: _e, ...sin } = web;
    const r = await request(app).post('/api/auth/registro-paciente').send(sin);
    expect(r.body.campos).toMatchObject({ sexo: 'Elija el sexo', email: expect.any(String) });
  });

  it('contraseña: mínimo 8, con letras y números, máximo 64, sin su DNI ni su nombre o apellido', async () => {
    const campo = async (password: string) => (await request(app).post('/api/auth/registro-paciente').send({ ...web, password })).body.campos?.password;
    expect(await campo('abc123')).toBe('La contraseña debe tener al menos 8 caracteres');
    expect(await campo('soloLetrasAqui')).toBe('La contraseña debe incluir números');
    expect(await campo(`a1${'x'.repeat(70)}`)).toBe('La contraseña debe tener como máximo 64 caracteres');
    expect(await campo('x45678912')).toBe('La contraseña no puede ser ni contener su DNI');
    expect(await campo('ELENA2026')).toBe('La contraseña no puede contener su nombre');
    expect(await campo('mendoza2026')).toBe('La contraseña no puede contener su apellido');
  });

  it('un menor de edad necesita apoderado (también en la web)', async () => {
    const r = await request(app).post('/api/auth/registro-paciente').send({ ...web, fechaNacimiento: hace(15) });
    expect(r.body.campos.apoderado).toBe(MENSAJE_APODERADO);
    expect((await request(app).post('/api/auth/registro-paciente').send({ ...web, fechaNacimiento: hace(15), apoderado: 'Rosa Ruiz (DNI 40000000, cel. 987000000)' })).status).toBe(201);
  });

  it('restablecer contraseña: el paciente tampoco puede usar su DNI ni su nombre', async () => {
    await request(app).post('/api/auth/registro-paciente').send(web);
    const { solicitarRecuperacion } = await import('../src/services/auth.service.js');
    const { bandejaDePrueba } = await import('../src/lib/correo.js');
    await solicitarRecuperacion(web.email);
    const token = /restablecer\?token=([\w-]+)/.exec(bandejaDePrueba.at(-1)!.html)![1];
    const r = await request(app).post('/api/auth/restablecer').send({ token, password: 'Elena12345' });
    expect(r.body.campos.password).toBe('La contraseña no puede contener su nombre');
    expect((await request(app).post('/api/auth/restablecer').send({ token, password: 'Dientes2027' })).status).toBe(200);
  });
});

describe('Registro presencial y Editar datos', () => {
  it('presencial: sexo obligatorio, correo opcional, apoderado para menores', async () => {
    const recep = await sesion('recepcionista');
    const base = { dni: '45678913', nombres: 'Luis', apellidos: 'Polo', fechaNacimiento: hace(8), telefono: '912345678' };
    const r = await recep.post('/api/pacientes').send(base);
    expect(r.body.campos).toMatchObject({ sexo: 'Elija el sexo', apoderado: MENSAJE_APODERADO });
    expect((await recep.post('/api/pacientes').send({ ...base, sexo: 'masculino', apoderado: 'Ana Polo (DNI 40000001, cel. 987000001)' })).status).toBe(201);
  });

  it('Editar datos: menor sin apoderado y sexo vacío se piden al guardar', async () => {
    const recep = await sesion('recepcionista');
    const p = (await recep.post('/api/pacientes/sin-dni').send({ nombres: 'José', apellidos: 'Pérez', fechaNacimiento: hace(8), telefono: '999999999', sexo: 'masculino', apoderado: 'Carla Pérez (cel. 988888888)' })).body;
    await prisma.paciente.update({ where: { id: p.id }, data: { apoderado: null, sexo: null } });
    const r = await recep.patch(`/api/pacientes/${p.id}`).send({ telefono: '999999998', nombres: 'José', apellidos: 'Pérez', fechaNacimiento: p.fechaNacimiento });
    expect(r.body.campos).toMatchObject({ apoderado: MENSAJE_APODERADO, sexo: 'Elija el sexo' });
  });

  it('Editar datos: con cuenta web el correo es obligatorio y se cambia también en la cuenta', async () => {
    const recep = await sesion('recepcionista');
    const id = await idPaciente('72458190');
    const p = (await recep.get(`/api/pacientes/${id}`)).body;
    expect(p.tieneCuenta).toBe(true);
    const datos = { telefono: p.telefono, nombres: p.nombres, apellidos: p.apellidos, fechaNacimiento: p.fechaNacimiento, sexo: p.sexo };
    expect((await recep.patch(`/api/pacientes/${id}`).send({ ...datos, email: '' })).body.campos.email).toBe('El paciente tiene cuenta web: el correo es obligatorio');
    expect((await recep.patch(`/api/pacientes/${id}`).send({ ...datos, email: 'maria.nueva@correo.local' })).status).toBe(200);
    expect((await prisma.usuario.findFirstOrThrow({ where: { paciente: { id } } })).email).toBe('maria.nueva@correo.local');
    expect((await recep.patch(`/api/pacientes/${id}`).send({ ...datos, email: 'ana.rios@clinica.local' })).status).toBe(409);
  });
});
