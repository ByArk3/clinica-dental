// Buscar cita (recepcionista): las citas de un paciente, próximas y anteriores, sin datos clínicos
import { beforeEach, describe, expect, it } from 'vitest';
import { crearCita, idPaciente, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

describe('Buscar cita', () => {
  it('separa próximas (con acciones) y anteriores (solo consulta), sin diagnósticos', async () => {
    const proxima = await crearCita({ horas: 72, estado: 'confirmada', token: 'tok-buscar' });
    const enVerif = await crearCita({ horas: 30, estado: 'pago_en_verificacion' });
    const pasada = await crearCita({ horas: -72, estado: 'atendida' });
    await prisma.cita.update({ where: { id: pasada.id }, data: { estado: 'pagada' } });
    const cancelada = await crearCita({ horas: 100, estado: 'cancelada' });
    const r = await (await sesion('recepcionista')).get(`/api/pacientes/${await idPaciente('72458190')}/citas`);
    expect(r.status).toBe(200);
    expect(r.body.paciente).toMatchObject({ dni: '72458190', nombres: 'María' });
    expect(r.body.proximas.map((c: { id: number }) => c.id)).toEqual([enVerif.id, proxima.id]); // en orden de fecha
    expect(r.body.proximas[1].whatsapp).toContain('wa.me');
    expect(r.body.anteriores.map((c: { id: number }) => c.id).sort()).toEqual([pasada.id, cancelada.id].sort());
    expect(JSON.stringify(r.body)).not.toMatch(/diagnostico|alergias/);
  });

  it('la búsqueda por nombre dice cuántas citas próximas tiene y cuándo es la siguiente', async () => {
    const c = await crearCita({ horas: 50, estado: 'confirmada' });
    const r = await (await sesion('recepcionista')).get('/api/pacientes/por-nombre').query({ apellidos: 'quispe' });
    expect(r.body[0]).toMatchObject({ proximas: 1, siguienteCita: `${c.fecha.toISOString().slice(0, 10)} ${c.hora.toISOString().slice(11, 16)}` });
  });

  it('solo la recepcionista', async () => {
    const id = await idPaciente('72458190');
    expect((await (await sesion('odontologo')).get(`/api/pacientes/${id}/citas`)).status).toBe(403);
    expect((await (await sesion('paciente')).get(`/api/pacientes/${id}/citas`)).status).toBe(403);
  });
});
