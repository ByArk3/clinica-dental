// Feriados (sin atención) y horario propio de cada odontólogo
import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { idOdontologo, idPaciente, prisma, proximo, reiniciarBD, sesion } from './helpers.js';
import { sumarDias } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

describe('Feriados', () => {
  it('ese día no hay horarios, no se puede reservar y se sugiere la siguiente fecha', async () => {
    const lunes = proximo(1);
    await prisma.feriado.create({ data: { fecha: new Date(`${lunes}T00:00:00Z`), nombre: 'Feriado de prueba' } });
    const pac = await sesion('paciente');
    const d = await pac.get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${lunes}`);
    expect(d.body).toMatchObject({ atiende: false, horarios: [], mensaje: `${MENSAJES.CLINICA_FERIADO}: Feriado de prueba`, siguienteFechaDisponible: sumarDias(lunes, 1) });
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: lunes, hora: '10:00', motivo: 'Control' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(`${MENSAJES.CLINICA_FERIADO}: Feriado de prueba`);
  });

  it('el Administrador agrega un feriado y recibe las citas de ese día para reprogramarlas', async () => {
    const recep = await sesion('recepcionista');
    const lunes = proximo(1);
    await recep.post('/api/citas').send({ pacienteId: await idPaciente('70112233'), odontologoId: await idOdontologo(), fecha: lunes, hora: '09:00', motivo: 'Control' });
    const admin = await sesion('administrador');
    const r = await admin.post('/api/admin/feriados').send({ fecha: lunes, nombre: 'Día no laborable' });
    expect(r.status).toBe(201);
    expect(r.body.citasAfectadas).toEqual([expect.objectContaining({ hora: '09:00', paciente: 'Lucía Torres Vega', telefono: '948222333' })]);
    const dup = await admin.post('/api/admin/feriados').send({ fecha: lunes, nombre: 'Otra vez' });
    expect(dup.status).toBe(409);
    const lista = await admin.get(`/api/admin/feriados?anio=${lunes.slice(0, 4)}`);
    expect(lista.body.map((f: { fecha: string }) => f.fecha)).toContain(lunes);
    expect((await admin.delete(`/api/admin/feriados/${r.body.feriado.id}`)).status).toBe(204);
    expect((await (await sesion('paciente')).get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${lunes}`)).body.atiende).toBe(true);
  });

  it('la semilla carga los feriados nacionales (por ejemplo, Navidad)', async () => {
    const { sembrar } = await import('../prisma/seed.js');
    await sembrar(prisma, { silencioso: true, horariosEjemplo: false, campanas: false, feriados: true });
    const anio = new Date().getFullYear();
    const navidad = await prisma.feriado.findUnique({ where: { fecha: new Date(`${anio}-12-25T00:00:00Z`) } });
    expect(navidad?.nombre).toBe('Navidad');
    expect(await prisma.feriado.count()).toBeGreaterThanOrEqual(30); // 16 por año, dos años
  });
});

describe('Horario propio de cada odontólogo', () => {
  it('Dr. Paredes L–V 08:00–14:00: el lunes 12 bloques; el sábado no atiende; la Dra. Díaz sigue con el general', async () => {
    const admin = await sesion('administrador');
    const id = await idOdontologo();
    const r = await admin.put(`/api/admin/odontologos/${id}/horario`).send({ tramos: [1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, horaInicio: '08:00', horaFin: '14:00' })) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ usaHorarioGeneral: false });
    expect(r.body.tramos).toHaveLength(5);
    const pac = await sesion('paciente');
    const lunes = await pac.get(`/api/disponibilidad?odontologoId=${id}&fecha=${proximo(1)}`);
    expect(lunes.body.horarios).toHaveLength(12);
    expect(lunes.body.horarios.at(-1)).toBe('13:30');
    const sabado = await pac.get(`/api/disponibilidad?odontologoId=${id}&fecha=${proximo(6)}`);
    expect(sabado.body).toMatchObject({ atiende: false, mensaje: MENSAJES.CLINICA_NO_ATIENDE });
    const diaz = await idOdontologo('carmen.diaz@clinica.local');
    expect((await pac.get(`/api/disponibilidad?odontologoId=${diaz}&fecha=${proximo(6)}`)).body.horarios).toHaveLength(24);
    // fuera de su horario no se puede reservar
    const fuera = await pac.post('/api/citas').send({ odontologoId: id, fecha: proximo(1), hora: '15:00', motivo: 'Control' });
    expect(fuera.body.mensaje).toBe(MENSAJES.FUERA_DE_HORARIO);
  });

  it('dos tramos el mismo día (mañana y tarde)', async () => {
    const admin = await sesion('administrador');
    const id = await idOdontologo();
    await admin.put(`/api/admin/odontologos/${id}/horario`).send({ tramos: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '10:00' }, { diaSemana: 1, horaInicio: '16:00', horaFin: '17:00' }] });
    const d = await (await sesion('paciente')).get(`/api/disponibilidad?odontologoId=${id}&fecha=${proximo(1)}`);
    expect(d.body.horarios).toEqual(['08:00', '08:30', '09:00', '09:30', '16:00', '16:30']);
  });

  it.each([
    [{ diaSemana: 7, horaInicio: '08:00', horaFin: '12:00' }, 'lunes a sábado'],
    [{ diaSemana: 1, horaInicio: '07:00', horaFin: '12:00' }, 'entre 08:00 y 20:00'],
    [{ diaSemana: 1, horaInicio: '12:00', horaFin: '10:00' }, 'anterior'],
    [{ diaSemana: 1, horaInicio: '08:15', horaFin: '12:00' }, '30 min'],
  ])('rechaza tramos inválidos: %o', async (tramo, texto) => {
    const admin = await sesion('administrador');
    const r = await admin.put(`/api/admin/odontologos/${await idOdontologo()}/horario`).send({ tramos: [tramo] });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toContain(texto);
  });

  it('rechaza tramos que se cruzan; sin tramos vuelve al horario general', async () => {
    const admin = await sesion('administrador');
    const id = await idOdontologo();
    const cruce = await admin.put(`/api/admin/odontologos/${id}/horario`).send({ tramos: [{ diaSemana: 2, horaInicio: '08:00', horaFin: '12:00' }, { diaSemana: 2, horaInicio: '11:00', horaFin: '13:00' }] });
    expect(cruce.body.mensaje).toContain('se cruzan');
    const vacio = await admin.put(`/api/admin/odontologos/${id}/horario`).send({ tramos: [] });
    expect(vacio.body.usaHorarioGeneral).toBe(true);
  });

  it('RNF07: solo el Administrador gestiona horarios y feriados', async () => {
    const recep = await sesion('recepcionista');
    expect((await recep.put(`/api/admin/odontologos/1/horario`).send({ tramos: [] })).status).toBe(403);
    expect((await recep.post('/api/admin/feriados').send({ fecha: '2030-01-02', nombre: 'X' })).status).toBe(403);
  });
});
