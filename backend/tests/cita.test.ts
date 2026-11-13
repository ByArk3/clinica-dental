import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { idOdontologo, idPaciente, prisma, proximo, reiniciarBD, sesion } from './helpers.js';
import { ahoraLima, sumarDias } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

const LUNES = () => proximo(1);
const DOMINGO = () => proximo(7);

describe('CU-05 Consultar disponibilidad', () => {
  it('flujo básico: lista los bloques de 30 min de 08:00 a 19:30 (P4/P5)', async () => {
    const pac = await sesion('paciente');
    const r = await pac.get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${LUNES()}`);
    expect(r.status).toBe(200);
    expect(r.body.atiende).toBe(true);
    expect(r.body.horarios).toHaveLength(24);
    expect(r.body.horarios[0]).toBe('08:00');
    expect(r.body.horarios.at(-1)).toBe('19:30');
  });

  it('descuenta las horas con citas activas, pero no las canceladas', async () => {
    const recep = await sesion('recepcionista');
    const odontologoId = await idOdontologo();
    const fecha = LUNES();
    const base = { odontologoId, fecha, motivo: 'Control' };
    await recep.post('/api/citas').send({ ...base, hora: '09:00', pacienteId: await idPaciente('70112233') });
    const c = await recep.post('/api/citas').send({ ...base, hora: '10:00', pacienteId: await idPaciente('71223344') });
    await prisma.cita.update({ where: { id: c.body.cita.id }, data: { estado: 'cancelada' } });

    const r = await recep.get(`/api/disponibilidad?odontologoId=${odontologoId}&fecha=${fecha}`);
    expect(r.body.horarios).not.toContain('09:00');
    expect(r.body.horarios).toContain('10:00');
  });

  it('el horario de un odontólogo no afecta al otro', async () => {
    const recep = await sesion('recepcionista');
    const fecha = LUNES();
    await recep.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha, hora: '09:00', motivo: 'Control', pacienteId: await idPaciente('70112233') });
    const otra = await idOdontologo('carmen.diaz@clinica.local');
    const r = await recep.get(`/api/disponibilidad?odontologoId=${otra}&fecha=${fecha}`);
    expect(r.body.horarios).toContain('09:00');
  });

  it('alterno: día sin atención → «La clínica no atiende ese día» y sugiere el lunes siguiente', async () => {
    const pac = await sesion('paciente');
    const domingo = DOMINGO();
    const r = await pac.get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${domingo}`);
    expect(r.body).toMatchObject({ atiende: false, horarios: [], mensaje: MENSAJES.CLINICA_NO_ATIENDE });
    expect(r.body.siguienteFechaDisponible).toBe(sumarDias(domingo, 1));
  });

  it('alterno: día lleno → «No hay horarios disponibles» y sugiere la siguiente fecha', async () => {
    const odontologoId = await idOdontologo();
    const fecha = LUNES();
    const pacienteId = await idPaciente('70112233');
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { rol: 'recepcionista' } });
    await prisma.cita.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({
        pacienteId,
        odontologoId,
        fecha: new Date(`${fecha}T00:00:00Z`),
        hora: new Date(Date.UTC(1970, 0, 1, 8, 30 * i)),
        motivo: 'Lleno',
        canal: 'presencial' as const,
        estado: 'confirmada' as const,
        creadoPorId: usuario.id,
      })),
    });
    const pac = await sesion('paciente');
    const r = await pac.get(`/api/disponibilidad?odontologoId=${odontologoId}&fecha=${fecha}`);
    expect(r.body).toMatchObject({ atiende: true, horarios: [], mensaje: MENSAJES.SIN_HORARIOS });
    expect(r.body.siguienteFechaDisponible).toBe(sumarDias(fecha, 1));
  });

  it('alterno: fecha pasada → no hay horarios', async () => {
    const pac = await sesion('paciente');
    const ayer = sumarDias(ahoraLima().fecha, -1);
    const r = await pac.get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${ayer}`);
    expect(r.body.horarios).toEqual([]);
    expect(r.body.mensaje).toBe(MENSAJES.HORA_PASADA);
  });
});

describe('CU-06 Registrar cita — web (paciente)', () => {
  it('flujo básico: el paciente sale de la sesión; queda «Pendiente de confirmación», canal web, con token', async () => {
    const pac = await sesion('paciente');
    const odontologoId = await idOdontologo();
    // aunque envíe otro pacienteId, se usa el de la sesión
    const r = await pac.post('/api/citas').send({ odontologoId, fecha: LUNES(), hora: '10:30', motivo: 'Dolor de muela', pacienteId: 9999 });
    expect(r.status).toBe(201);
    expect(r.body.cita).toMatchObject({ estado: 'pendiente_adelanto', montoAdelanto: '20.00', canal: 'web', hora: '10:30', odontologo: 'Dr. Luis Paredes' });
    expect(r.body.cita.pacienteId).toBe(await idPaciente('72458190'));
    expect(r.body.cita.tokenConfirmacion).toBeUndefined(); // el token no se expone (RNF08)
    const enBD = await prisma.cita.findUniqueOrThrow({ where: { id: r.body.cita.id } });
    expect(enBD.tokenConfirmacion).toMatch(/^[0-9a-f]{48}$/);

    const mias = await pac.get('/api/citas/mias');
    expect(mias.body.map((c: { id: number }) => c.id)).toContain(r.body.cita.id);
  });
});

describe('CU-06 Registrar cita — presencial (recepcionista)', () => {
  it('flujo básico: busca por DNI y registra la cita con canal presencial', async () => {
    const recep = await sesion('recepcionista');
    const paciente = (await recep.get('/api/pacientes?dni=72458190')).body;
    const r = await recep.post('/api/citas').send({ pacienteId: paciente.id, odontologoId: await idOdontologo(), fecha: LUNES(), hora: '08:00', motivo: 'Limpieza' });
    expect(r.status).toBe(201);
    expect(r.body.cita).toMatchObject({ canal: 'presencial', estado: 'pendiente_adelanto', pacienteId: paciente.id });
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.rios@clinica.local' } });
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: r.body.cita.id } })).creadoPorId).toBe(usuario.id);
  });

  it('alterno 4.1: DNI no registrado → se registra el paciente (CU-03) y se continúa con la cita', async () => {
    const recep = await sesion('recepcionista');
    expect((await recep.get('/api/pacientes?dni=40404040')).status).toBe(404);
    const nuevo = await recep.post('/api/pacientes').send({ dni: '40404040', nombres: 'Raúl', apellidos: 'Gómez', fechaNacimiento: '1970-02-02', telefono: '911222333', sexo: 'masculino' });
    expect(nuevo.status).toBe(201);
    const r = await recep.post('/api/citas').send({ pacienteId: nuevo.body.id, odontologoId: await idOdontologo(), fecha: LUNES(), hora: '11:00', motivo: 'Evaluación' });
    expect(r.status).toBe(201);
  });

  it('RN-01: sin paciente → 422', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: LUNES(), hora: '11:00', motivo: 'Evaluación' });
    expect(r.status).toBe(422);
    expect(r.body.campos.pacienteId).toBeDefined();
  });

  it('RN-01: sin hora → 422; el motivo es opcional pero, si se escribe, debe tener palabras', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/citas').send({ pacienteId: 1, odontologoId: await idOdontologo(), fecha: LUNES() });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.campos)).toEqual(['hora']);
    const raro = await recep.post('/api/citas').send({ pacienteId: 1, odontologoId: await idOdontologo(), fecha: LUNES(), hora: '09:00', motivo: 'sdsd23232323' });
    expect(raro.body.campos.motivo).toBe('Revise el texto: separe las palabras de los números (ej.: «500 mg»)');
    expect((await recep.post('/api/citas').send({ pacienteId: 1, odontologoId: await idOdontologo(), fecha: LUNES(), hora: '09:00', motivo: '12345' })).body.campos.motivo).toBe('Escriba con palabras (al menos 3 letras)');
  });

  it('pendiente 21: sin motivo, la agenda muestra el tratamiento previsto', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/citas').send({ pacienteId: 1, odontologoId: await idOdontologo(), fecha: LUNES(), hora: '09:00' });
    expect(r.status).toBe(201);
    expect(r.body.cita).toMatchObject({ motivo: 'Consulta', motivoEscrito: '' });
  });
});

describe('CU-06 Reglas de negocio y flujos alternos', () => {
  it('alterno 8.1 / RN-02: horario tomado mientras se elegía → 409 «El horario ya no está disponible»', async () => {
    const recep = await sesion('recepcionista');
    const pac = await sesion('paciente');
    const datos = { odontologoId: await idOdontologo(), fecha: LUNES(), hora: '15:00', motivo: 'Control' };
    expect((await recep.post('/api/citas').send({ ...datos, pacienteId: await idPaciente('70112233') })).status).toBe(201);
    const r = await pac.post('/api/citas').send(datos);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ codigo: 'HORARIO_NO_DISPONIBLE', mensaje: MENSAJES.HORARIO_NO_DISPONIBLE });
  });

  it('RN-02: reservas simultáneas web y presencial del mismo horario → solo una se graba', async () => {
    const recep = await sesion('recepcionista');
    const pac = await sesion('paciente');
    const datos = { odontologoId: await idOdontologo(), fecha: LUNES(), hora: '16:00', motivo: 'Control' };
    const [a, b] = await Promise.all([
      recep.post('/api/citas').send({ ...datos, pacienteId: await idPaciente('70112233') }),
      pac.post('/api/citas').send(datos),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.cita.count({ where: { hora: new Date('1970-01-01T16:00:00Z') } })).toBe(1);
  });

  it('RN-02: la base de datos rechaza un duplicado aunque se salte el servicio (índice parcial)', async () => {
    const recep = await sesion('recepcionista');
    const datos = { odontologoId: await idOdontologo(), fecha: LUNES(), hora: '17:00', motivo: 'Control' };
    const r = await recep.post('/api/citas').send({ ...datos, pacienteId: await idPaciente('70112233') });
    const original = await prisma.cita.findUniqueOrThrow({ where: { id: r.body.cita.id } });
    const { id: _id, tokenConfirmacion: _t, createdAt: _c, updatedAt: _u, recordatorioEnviadoEn: _r, ...copia } = original;
    await expect(prisma.cita.create({ data: copia })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('una cita cancelada libera el horario para otra reserva', async () => {
    const recep = await sesion('recepcionista');
    const datos = { odontologoId: await idOdontologo(), fecha: LUNES(), hora: '18:00', motivo: 'Control' };
    const r = await recep.post('/api/citas').send({ ...datos, pacienteId: await idPaciente('70112233') });
    await prisma.cita.update({ where: { id: r.body.cita.id }, data: { estado: 'cancelada' } });
    const otra = await recep.post('/api/citas').send({ ...datos, pacienteId: await idPaciente('71223344') });
    expect(otra.status).toBe(201);
  });

  it('alterno 8.2 / RN-12: paciente restringido (3+ inasistencias) → «Pendiente de adelanto» con aviso', async () => {
    await prisma.paciente.update({ where: { dni: '73445566' }, data: { inasistencias: 3, restringido: true } });
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/citas').send({ pacienteId: await idPaciente('73445566'), odontologoId: await idOdontologo(), fecha: LUNES(), hora: '12:00', motivo: 'Control' });
    expect(r.status).toBe(201);
    expect(r.body.cita).toMatchObject({ estado: 'pendiente_adelanto', montoAdelanto: '40.00' }); // 100 % de la consulta
    expect(r.body.aviso).toBe(MENSAJES.ADELANTO_OBLIGATORIO);
  });

  it('RN-12: con 2 inasistencias (sin restricción) paga el 50 % como todos', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/citas').send({ pacienteId: await idPaciente('73445566'), odontologoId: await idOdontologo(), fecha: LUNES(), hora: '12:30', motivo: 'Control' });
    expect(r.body.cita).toMatchObject({ estado: 'pendiente_adelanto', montoAdelanto: '20.00' });
  });

  it('RN-03: día sin atención → 422 «La clínica no atiende ese día»', async () => {
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: DOMINGO(), hora: '10:00', motivo: 'Control' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.CLINICA_NO_ATIENDE);
  });

  it.each(['07:30', '20:00', '10:15'])('RN-03: hora %s fuera del horario o de los bloques → 422', async (hora) => {
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: LUNES(), hora, motivo: 'Control' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.FUERA_DE_HORARIO);
  });

  it('no permite reservar en una fecha pasada', async () => {
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: sumarDias(ahoraLima().fecha, -7), hora: '10:00', motivo: 'Control' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.HORA_PASADA);
  });

  it('odontólogo desactivado → 422', async () => {
    const odontologoId = await idOdontologo();
    await prisma.odontologo.update({ where: { id: odontologoId }, data: { activo: false } });
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId, fecha: LUNES(), hora: '10:00', motivo: 'Control' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.ODONTOLOGO_NO_DISPONIBLE);
  });

  it('RNF07: el odontólogo y el administrador no registran citas; sin sesión → 401', async () => {
    const datos = { odontologoId: await idOdontologo(), fecha: LUNES(), hora: '10:00', motivo: 'Control', pacienteId: 1 };
    expect((await (await sesion('odontologo')).post('/api/citas').send(datos)).status).toBe(403);
    expect((await (await sesion('administrador')).post('/api/citas').send(datos)).status).toBe(403);
    const { app } = await import('./helpers.js');
    const request = (await import('supertest')).default;
    expect((await request(app).post('/api/citas').send(datos)).status).toBe(401);
  });
});
