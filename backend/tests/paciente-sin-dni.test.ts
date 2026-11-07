// Paciente sin DNI a la mano, búsqueda por nombre y CU-58 Corregir datos del paciente / de la cita
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, idPaciente, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);
afterEach(() => {
  delete process.env.RENIEC_TOKEN;
  vi.restoreAllMocks();
});

const juana = { nombres: 'Juana', apellidos: 'Rosales Mendoza', fechaNacimiento: '1988-03-14', sexo: 'femenino', telefono: '951234567', alergias: 'Ninguna' };

describe('Búsqueda por nombre (recepcionista)', () => {
  it('sin tildes y con un error de tipeo; solo datos para distinguir homónimos (celular parcial, sin datos clínicos)', async () => {
    const r = await (await sesion('recepcionista')).get('/api/pacientes/por-nombre').query({ apellidos: 'quizpe', nombres: 'maria' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toEqual({ id: await idPaciente('72458190'), dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', edad: expect.any(Number), celular: '***-***-456' });
    const tilde = await (await sesion('recepcionista')).get('/api/pacientes/por-nombre').query({ apellidos: 'huaman' });
    expect(tilde.body.map((p: { nombres: string }) => p.nombres)).toEqual(['Rosa']);
  });

  it('pide al menos 2 letras del apellido; el odontólogo no usa esta búsqueda', async () => {
    expect((await (await sesion('recepcionista')).get('/api/pacientes/por-nombre').query({ apellidos: 'q' })).status).toBe(422);
    expect((await (await sesion('odontologo')).get('/api/pacientes/por-nombre').query({ apellidos: 'quispe' })).status).toBe(403);
  });
});

describe('Registro sin DNI («DNI pendiente»)', () => {
  it('registra con nombres, apellidos, nacimiento, sexo y celular; queda dni = null con su ficha', async () => {
    const r = await (await sesion('recepcionista')).post('/api/pacientes/sin-dni').send(juana);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ dni: null, nombres: 'Juana', apellidos: 'Rosales Mendoza', sexo: 'femenino' });
    expect(await prisma.fichaPaciente.count({ where: { pacienteId: r.body.id } })).toBe(1);
    // se puede registrar más de uno sin DNI (el índice único admite varios null)
    expect((await (await sesion('recepcionista')).post('/api/pacientes/sin-dni').send({ ...juana, nombres: 'Ana' })).status).toBe(201);
    const lista = await (await sesion('administrador')).get('/api/pacientes/sin-dni');
    expect(lista.body).toHaveLength(2);
    expect((await (await sesion('administrador')).get('/api/panel')).body.agenda.pacientesSinDni).toBe(2);
  });

  it('el sexo es obligatorio sin DNI; la búsqueda con la fecha de nacimiento pone primero al posible duplicado', async () => {
    const { sexo: _s, ...sinSexo } = juana;
    expect((await (await sesion('recepcionista')).post('/api/pacientes/sin-dni').send(sinSexo)).status).toBe(422);
    const recep = await sesion('recepcionista');
    await recep.post('/api/pacientes/sin-dni').send({ ...juana, apellidos: 'Rosales Pérez', fechaNacimiento: '1965-01-01' });
    await recep.post('/api/pacientes/sin-dni').send(juana);
    const r = await recep.get('/api/pacientes/por-nombre').query({ apellidos: 'Rosales', nombres: 'Juana', fechaNacimiento: '1988-03-14' });
    expect(r.body.map((p: { apellidos: string }) => p.apellidos)).toEqual(['Rosales Mendoza', 'Rosales Pérez']);
  });

  it('se le puede sacar cita igual que a cualquier paciente', async () => {
    const recep = await sesion('recepcionista');
    const p = (await recep.post('/api/pacientes/sin-dni').send(juana)).body;
    const c = await crearCita({ horas: 72, estado: 'pendiente_adelanto' });
    await prisma.cita.update({ where: { id: c.id }, data: { pacienteId: p.id } });
    const dia = await recep.get(`/api/citas?fecha=${c.fecha.toISOString().slice(0, 10)}`);
    expect(dia.body.find((x: { id: number }) => x.id === c.id).paciente.dni).toBeNull();
  });
});

describe('Completar o cambiar el DNI', () => {
  it('la recepcionista completa un DNI pendiente; queda en la auditoría', async () => {
    const recep = await sesion('recepcionista');
    const p = (await recep.post('/api/pacientes/sin-dni').send(juana)).body;
    const r = await recep.put(`/api/pacientes/${p.id}/dni`).send({ dni: '45123987' });
    expect(r.status).toBe(200);
    expect(r.body.dni).toBe('45123987');
    const a = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'cambiar_dni' } });
    expect(a).toMatchObject({ pacienteId: p.id, detalle: 'Completó el DNI pendiente: 45123987' });
  });

  it('no deja usar el DNI de otro paciente', async () => {
    const recep = await sesion('recepcionista');
    const p = (await recep.post('/api/pacientes/sin-dni').send(juana)).body;
    const r = await recep.put(`/api/pacientes/${p.id}/dni`).send({ dni: '72458190' });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(`${MENSAJES.DNI_DUPLICADO}: María Quispe Rojas`);
  });

  it('si RENIEC devuelve otros nombres, avisa; con «confirmar» se guarda igual', async () => {
    process.env.RENIEC_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ first_name: 'PEDRO', first_last_name: 'LOPEZ', second_last_name: 'DIAZ' }), { status: 200 }));
    const recep = await sesion('recepcionista');
    const p = (await recep.post('/api/pacientes/sin-dni').send(juana)).body;
    const r = await recep.put(`/api/pacientes/${p.id}/dni`).send({ dni: '45123987' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ codigo: 'DNI_RENIEC_NO_COINCIDE', campos: { reniec: 'Pedro Lopez Diaz' } });
    expect((await recep.put(`/api/pacientes/${p.id}/dni`).send({ dni: '45123987', confirmar: true })).status).toBe(200);
  });

  it('RENIEC con los mismos nombres (en mayúsculas y sin tildes) no pide confirmar', async () => {
    process.env.RENIEC_TOKEN = 't';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ first_name: 'JUANA', first_last_name: 'ROSALES', second_last_name: 'MENDOZA' }), { status: 200 }));
    const recep = await sesion('recepcionista');
    const p = (await recep.post('/api/pacientes/sin-dni').send(juana)).body;
    expect((await recep.put(`/api/pacientes/${p.id}/dni`).send({ dni: '45123987' })).status).toBe(200);
  });

  it('un DNI ya registrado solo lo cambia el Administrador, con motivo', async () => {
    const id = await idPaciente('70112233');
    const recep = await (await sesion('recepcionista')).put(`/api/pacientes/${id}/dni`).send({ dni: '70112234' });
    expect(recep.status).toBe(403);
    expect(recep.body.mensaje).toBe(MENSAJES.DNI_SOLO_ADMIN);
    const admin = await sesion('administrador');
    expect((await admin.put(`/api/pacientes/${id}/dni`).send({ dni: '70112234' })).status).toBe(422);
    const r = await admin.put(`/api/pacientes/${id}/dni`).send({ dni: '70112234', motivo: 'Se digitó mal un número' });
    expect(r.status).toBe(200);
    expect((await prisma.auditoria.findFirstOrThrow({ where: { accion: 'cambiar_dni' } })).detalle).toBe('DNI: «70112233» → «70112234». Motivo: Se digitó mal un número');
  });
});

describe('CU-58 Corregir datos del paciente', () => {
  const datos = async (dni = '72334455') => {
    const p = (await (await sesion('recepcionista')).get(`/api/pacientes/${await idPaciente(dni)}`)).body;
    return { id: p.id, base: { telefono: p.telefono, email: p.email ?? '', direccion: p.direccion ?? '', apoderado: p.apoderado ?? '', nombres: p.nombres, apellidos: p.apellidos, fechaNacimiento: p.fechaNacimiento, sexo: p.sexo } };
  };

  it('devuelve los datos actuales para precargar el formulario (sin datos clínicos)', async () => {
    const r = await (await sesion('recepcionista')).get(`/api/pacientes/${await idPaciente('72458190')}`);
    expect(r.body).toMatchObject({ dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', fechaNacimiento: '1990-04-12', telefono: '949123456' });
    expect(r.body).not.toHaveProperty('alergias');
    expect(r.body).not.toHaveProperty('ficha');
  });

  it('cambiar solo el contacto no pide motivo ni deja auditoría', async () => {
    const { id, base } = await datos();
    const r = await (await sesion('recepcionista')).patch(`/api/pacientes/${id}`).send({ ...base, telefono: '987000111' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ paciente: { telefono: '987000111' }, cambios: ['Celular'] });
    expect(await prisma.auditoria.count({ where: { accion: 'corregir_paciente' } })).toBe(0);
  });

  it('cambiar un dato de identidad pide motivo y deja el antes y el después en la auditoría', async () => {
    const { id, base } = await datos();
    const recep = await sesion('recepcionista');
    const sin = await recep.patch(`/api/pacientes/${id}`).send({ ...base, apellidos: 'Huamán Torres' });
    expect(sin.status).toBe(422);
    expect(sin.body.campos.motivo).toBe(MENSAJES.MOTIVO_CORRECCION);
    const r = await recep.patch(`/api/pacientes/${id}`).send({ ...base, apellidos: 'Huamán Torres', motivo: 'Se escribió mal el apellido' });
    expect(r.status).toBe(200);
    const a = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'corregir_paciente' } });
    expect(a.detalle).toBe('Apellidos: «Huamán» → «Huamán Torres». Motivo: Se escribió mal el apellido');
  });

  it('sin cambios → 422; el odontólogo no corrige datos del paciente', async () => {
    const { id, base } = await datos();
    expect((await (await sesion('recepcionista')).patch(`/api/pacientes/${id}`).send(base)).body.mensaje).toBe(MENSAJES.SIN_CAMBIOS);
    expect((await (await sesion('odontologo')).patch(`/api/pacientes/${id}`).send({ ...base, telefono: '987000111' })).status).toBe(403);
  });
});

describe('Editar datos de la cita', () => {
  it('cambia el motivo y queda en la auditoría', async () => {
    const c = await crearCita({ horas: 72, estado: 'confirmada' });
    const r = await (await sesion('recepcionista')).patch(`/api/citas/${c.id}/datos`).send({ motivo: 'Dolor al masticar' });
    expect(r.status).toBe(200);
    expect(r.body.motivo).toBe('Dolor al masticar');
    expect((await prisma.auditoria.findFirstOrThrow({ where: { accion: 'editar_cita' } })).detalle).toBe(`Cita #${c.id}. Motivo: «Prueba» → «Dolor al masticar»`);
  });

  it('sin adelanto pagado: cambia el tratamiento previsto y recalcula el adelanto', async () => {
    const c = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20 });
    const profilaxis = await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: 'Profilaxis' } });
    const r = await (await sesion('recepcionista')).patch(`/api/citas/${c.id}/datos`).send({ motivo: 'Prueba', tratamientoPrevistoId: profilaxis.id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tratamientoPrevisto: 'Profilaxis', tratamientoPrevistoId: profilaxis.id, montoAdelanto: profilaxis.precio.div(2).toFixed(2) });
  });

  it('con el adelanto pagado (o en verificación) el tratamiento no cambia; una cita atendida no se edita', async () => {
    const profilaxis = await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: 'Profilaxis' } });
    const recep = await sesion('recepcionista');
    const enVerif = await crearCita({ horas: 72, estado: 'pago_en_verificacion' });
    const r = await recep.patch(`/api/citas/${enVerif.id}/datos`).send({ motivo: 'Prueba', tratamientoPrevistoId: profilaxis.id });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.TRATAMIENTO_CON_ADELANTO);
    const atendida = await crearCita({ horas: -2, estado: 'atendida' });
    expect((await recep.patch(`/api/citas/${atendida.id}/datos`).send({ motivo: 'Otro' })).body.mensaje).toBe(MENSAJES.CITA_NO_EDITABLE);
  });
});
