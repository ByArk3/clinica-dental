import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, idOdontologo, prisma, proximo, reiniciarBD, sesion } from './helpers.js';
import { dateAFecha } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

describe('CU-09 Citas del día', () => {
  it('lista las citas de la fecha con estado y contacto, sin la ficha clínica (RN-07)', async () => {
    const c = await crearCita({ horas: -2, estado: 'confirmada' });
    const recep = await sesion('recepcionista');
    const r = await recep.get(`/api/citas?fecha=${dateAFecha(c.fecha)}`);
    expect(r.status).toBe(200);
    const fila = r.body.find((x: { id: number }) => x.id === c.id);
    expect(fila).toMatchObject({ estado: 'confirmada', puedeRegistrarInasistencia: true, paciente: { nombres: 'María', telefono: '949123456' } });
    expect(JSON.stringify(r.body)).not.toContain('Penicilina');
  });

  it('incluye el enlace de WhatsApp para recordar las citas confirmadas (P7); no a las que aún no pagan el adelanto', async () => {
    const recep = await sesion('recepcionista');
    const r1 = await recep.post('/api/citas').send({ pacienteId: (await prisma.paciente.findUniqueOrThrow({ where: { dni: '70112233' } })).id, odontologoId: await idOdontologo(), fecha: proximo(1), hora: '09:00', motivo: 'Control' });
    const antes = (await recep.get(`/api/citas?fecha=${proximo(1)}`)).body.find((x: { id: number }) => x.id === r1.body.cita.id);
    expect(antes.whatsapp).toBeUndefined();
    await recep.post(`/api/caja/citas/${r1.body.cita.id}/comprobante`).send({ tipoPagoId: (await prisma.tipoPago.findUniqueOrThrow({ where: { nombre: 'Efectivo' } })).id, montoRecibido: 20 });
    const r = await recep.get(`/api/citas?fecha=${proximo(1)}`);
    const fila = r.body.find((x: { id: number }) => x.id === r1.body.cita.id);
    expect(fila.whatsapp).toMatch(/^https:\/\/wa\.me\/51948222333\?text=/);
    const texto = decodeURIComponent(fila.whatsapp);
    expect(texto).toContain('/citas/recordatorio/');
    expect(texto).toContain('cancelar o reprogramar');
  });

  it('RNF07: solo la recepcionista ve la agenda del día', async () => {
    expect((await (await sesion('paciente')).get('/api/citas?fecha=2030-01-07')).status).toBe(403);
  });
});

describe('CU-09 Registrar inasistencia', () => {
  it('flujo básico: «Inasistencia», contador +1 y nota en la ficha', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/citas/${c.id}/inasistencia`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'inasistencia', inasistencias: 1, restringido: false });
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('inasistencia');
    const ficha = await prisma.fichaPaciente.findFirstOrThrow({ where: { paciente: { dni: '72458190' } } });
    expect(ficha.notas).toMatch(/inasistencia \(1\.ª\)/);
  });

  it('alterno 6.1: al llegar a 3 → paciente restringido y aviso de adelanto (RN-12)', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada', dni: '73445566' }); // Pedro: 2 inasistencias
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/citas/${c.id}/inasistencia`);
    expect(r.body).toMatchObject({ inasistencias: 3, restringido: true, aviso: MENSAJES.PACIENTE_RESTRINGIDO });
    expect((await prisma.paciente.findUniqueOrThrow({ where: { dni: '73445566' } })).restringido).toBe(true);
    // su siguiente cita queda pendiente de adelanto
    const nueva = await recep.post('/api/citas').send({ pacienteId: c.pacienteId, odontologoId: await idOdontologo(), fecha: proximo(1), hora: '10:00', motivo: 'Control' });
    expect(nueva.body.cita.estado).toBe('pendiente_adelanto');
  });

  it('alterno 3.1: la hora de la cita aún no pasó → 422', async () => {
    const c = await crearCita({ horas: 3, estado: 'confirmada' });
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/citas/${c.id}/inasistencia`);
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.HORA_NO_PASADA);
    expect((await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).inasistencias).toBe(0);
  });

  it('solo sobre citas confirmadas; no se registra dos veces', async () => {
    const pendiente = await crearCita({ horas: -1 });
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/citas/${pendiente.id}/inasistencia`);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.INASISTENCIA_SOLO_CONFIRMADA);

    const c = await crearCita({ horas: -2, estado: 'confirmada', odontologoEmail: 'carmen.diaz@clinica.local' });
    await recep.post(`/api/citas/${c.id}/inasistencia`);
    expect((await recep.post(`/api/citas/${c.id}/inasistencia`)).status).toBe(409);
    expect((await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).inasistencias).toBe(1);
  });
});

describe('CU-04 Actualizar datos de contacto', () => {
  it('el paciente actualiza sus propios datos', async () => {
    const pac = await sesion('paciente');
    const r = await pac.patch('/api/pacientes/me').send({ telefono: '912345678', email: 'maria.nuevo@correo.local', direccion: 'Av. España 123, Trujillo' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ telefono: '912345678', email: 'maria.nuevo@correo.local', direccion: 'Av. España 123, Trujillo' });
    expect((await pac.get('/api/pacientes/me')).body.telefono).toBe('912345678');
  });

  it('la recepcionista actualiza el contacto de cualquier paciente', async () => {
    const recep = await sesion('recepcionista');
    const id = (await prisma.paciente.findUniqueOrThrow({ where: { dni: '70112233' } })).id;
    const r = await recep.patch(`/api/pacientes/${id}/contacto`).send({ telefono: '900111222' });
    expect(r.body.telefono).toBe('900111222');
  });

  it('valida el teléfono (9 dígitos) y el correo', async () => {
    const pac = await sesion('paciente');
    const r = await pac.patch('/api/pacientes/me').send({ telefono: '123', email: 'no-es-correo' });
    expect(r.status).toBe(422);
    expect(r.body.campos).toMatchObject({ telefono: 'El teléfono debe tener 9 dígitos', email: 'Correo inválido' });
  });

  it('RNF07: el paciente no puede editar a otro paciente por la ruta de recepción', async () => {
    const pac = await sesion('paciente');
    expect((await pac.patch('/api/pacientes/2/contacto').send({ telefono: '900111222' })).status).toBe(403);
  });
});
