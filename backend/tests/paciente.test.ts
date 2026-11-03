import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

const nuevo = {
  dni: '45678912',
  nombres: 'Elena',
  apellidos: 'Mendoza Ruiz',
  fechaNacimiento: '1992-07-19',
  telefono: '987654321',
  alergias: 'Látex',
};

describe('CU-03 Registrar paciente', () => {
  it('flujo básico (recepcionista): crea el paciente y su ficha (RN-05)', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/pacientes').send(nuevo);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ dni: '45678912', fechaNacimiento: '1992-07-19', inasistencias: 0 });
    const ficha = await prisma.fichaPaciente.findUnique({ where: { pacienteId: r.body.id } });
    expect(ficha?.alergias).toBe('Látex');
  });

  it('alterno: DNI ya registrado → 409', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/pacientes').send({ ...nuevo, dni: '72458190' });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.DNI_DUPLICADO);
  });

  it('alterno: datos inválidos → 422 con el campo señalado', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/pacientes').send({ ...nuevo, dni: '123' });
    expect(r.status).toBe(422);
    expect(r.body.campos.dni).toBe('El DNI debe tener 8 dígitos');
  });

  it('registro web: el paciente crea su cuenta, queda con sesión iniciada y con ficha', async () => {
    const agente = request.agent(app);
    const r = await agente
      .post('/api/auth/registro-paciente')
      .send({ ...nuevo, email: 'elena@correo.local', password: 'MiClave2026' });
    expect(r.status).toBe(201);
    expect(r.body.rol).toBe('paciente');
    expect((await agente.get('/api/auth/yo')).body.pacienteId).toBe(r.body.pacienteId);
    expect(await prisma.fichaPaciente.count({ where: { pacienteId: r.body.pacienteId } })).toBe(1);
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@correo.local' } });
    expect(usuario.password).not.toBe('MiClave2026'); // RNF05: guardada con bcrypt
  });

  it('registro web de un paciente ya atendido en la clínica: se vincula a su DNI existente', async () => {
    const r = await request(app)
      .post('/api/auth/registro-paciente')
      .send({ ...nuevo, dni: '70112233', email: 'lucia@correo.local', password: 'MiClave2026' });
    expect(r.status).toBe(201);
    const lucia = await prisma.paciente.findUniqueOrThrow({ where: { dni: '70112233' } });
    expect(r.body.pacienteId).toBe(lucia.id);
    expect(lucia.nombres).toBe('Lucía'); // no se pisan los datos registrados por la clínica
  });

  it('registro web: correo ya usado → 409', async () => {
    const r = await request(app)
      .post('/api/auth/registro-paciente')
      .send({ ...nuevo, email: 'maria.quispe@correo.local', password: 'MiClave2026' });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.EMAIL_DUPLICADO);
  });
});

describe('Buscar paciente por DNI (CU-06 presencial)', () => {
  it('devuelve solo datos de contacto, nunca la ficha clínica (RN-07)', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.get('/api/pacientes?dni=72458190');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nombres: 'María', apellidos: 'Quispe Rojas' });
    expect(r.body.ficha).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('Penicilina');
  });

  it('alterno 4.1: DNI no registrado → 404 «Paciente no encontrado»', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.get('/api/pacientes?dni=99999999');
    expect(r.status).toBe(404);
    expect(r.body.mensaje).toBe(MENSAJES.PACIENTE_NO_ENCONTRADO);
  });
});
