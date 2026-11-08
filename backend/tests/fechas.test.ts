// Fechas con sentido: nacimiento hacia atrás, citas hasta un año adelante, feriados y campañas hacia adelante, filtros hasta hoy
import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES, mensajeHastaUnAnio, moverFecha } from '@clinica/shared';
import { idOdontologo, prisma, reiniciarBD, sesion } from './helpers.js';
import { ahoraLima, diaSemana, sumarDias } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);
const hoy = () => ahoraLima().fecha;
const paciente = (fechaNacimiento: string) => ({ dni: '45678912', nombres: 'Ana', apellidos: 'Prueba', fechaNacimiento, telefono: '987654321', sexo: 'femenino', apoderado: 'Rosa Prueba (DNI 40000000, cel. 987000000)' });

describe('Fecha de nacimiento', () => {
  it('no puede ser futura ni de hace más de 120 años; hoy sí (recién nacido)', async () => {
    const recep = await sesion('recepcionista');
    const futura = await recep.post('/api/pacientes').send(paciente('2030-01-09'));
    expect(futura.status).toBe(422);
    expect(futura.body.campos.fechaNacimiento).toBe('La fecha de nacimiento no puede ser futura');
    expect((await recep.post('/api/pacientes').send(paciente('1890-01-01'))).body.campos.fechaNacimiento).toMatch(/120 años/);
    expect((await recep.post('/api/pacientes').send(paciente('2026-02-30'))).body.campos.fechaNacimiento).toBe('Fecha inválida');
    expect((await recep.post('/api/pacientes').send(paciente(hoy()))).status).toBe(201);
  });

  it('también al corregir los datos del paciente', async () => {
    const recep = await sesion('recepcionista');
    const p = (await recep.get(`/api/pacientes/${(await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).id}`)).body;
    const r = await recep.patch(`/api/pacientes/${p.id}`).send({ telefono: p.telefono, nombres: p.nombres, apellidos: p.apellidos, fechaNacimiento: sumarDias(hoy(), 1), sexo: p.sexo, motivo: 'Prueba de fecha' });
    expect(r.body.campos.fechaNacimiento).toBe('La fecha de nacimiento no puede ser futura');
  });
});

describe('Citas: de hoy hasta un año adelante', () => {
  it('más de un año → 422 y la disponibilidad lo explica', async () => {
    let lejos = moverFecha(hoy(), { anios: 1, dias: 1 });
    while (diaSemana(lejos) === 7) lejos = sumarDias(lejos, 1);
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: lejos, hora: '10:00', motivo: 'Control' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.FECHA_MUY_LEJANA);
    const d = await pac.get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${lejos}`);
    expect(d.body).toMatchObject({ horarios: [], mensaje: MENSAJES.FECHA_MUY_LEJANA });
  });
});

describe('Feriados, campañas y filtros', () => {
  it('feriado de hoy en adelante; campaña que termine hoy o después', async () => {
    const admin = await sesion('administrador');
    expect((await admin.post('/api/admin/feriados').send({ fecha: sumarDias(hoy(), -1), nombre: 'Ayer' })).body.campos.fecha).toBe('El feriado debe ser de hoy en adelante');
    const consulta = (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: 'Consulta' } })).id;
    const pasada = await admin.post('/api/admin/descuentos').send({ nombre: 'Ya pasó', porcentaje: 10, fechaInicio: '2020-01-01', fechaFin: '2020-01-31', tratamientos: [consulta] });
    expect(pasada.body.campos.fechaFin).toBe('La campaña debe terminar hoy o después');
    // una campaña que ya empezó se puede seguir editando (su inicio puede estar en el pasado)
    expect((await admin.post('/api/admin/descuentos').send({ nombre: 'En curso', porcentaje: 10, fechaInicio: sumarDias(hoy(), -5), fechaFin: sumarDias(hoy(), 5), tratamientos: [consulta] })).status).toBe(201);
  });

  it('feriados y campañas: como máximo un año desde hoy (también rechaza años de 5 dígitos)', async () => {
    const admin = await sesion('administrador');
    const tope = moverFecha(hoy(), { anios: 1 });
    const pasado = sumarDias(tope, 1);
    expect((await admin.post('/api/admin/feriados').send({ fecha: pasado, nombre: 'Muy lejos' })).body.campos.fecha).toBe(mensajeHastaUnAnio());
    expect((await admin.post('/api/admin/feriados').send({ fecha: tope, nombre: 'Al límite' })).status).toBe(201);
    expect((await admin.post('/api/admin/feriados').send({ fecha: '20266-01-01', nombre: 'Año raro' })).status).toBe(422);
    const consulta = (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: 'Consulta' } })).id;
    const larga = await admin.post('/api/admin/descuentos').send({ nombre: 'Muy larga', porcentaje: 10, fechaInicio: hoy(), fechaFin: pasado, tratamientos: [consulta] });
    expect(larga.body.campos.fechaFin).toBe(mensajeHastaUnAnio());
    expect((await admin.post('/api/admin/descuentos').send({ nombre: 'Un año', porcentaje: 10, fechaInicio: hoy(), fechaFin: tope, tratamientos: [consulta] })).status).toBe(201);
  });

  it('reportes, kárdex y auditoría: «hasta» no pasa de hoy ni es anterior a «desde»', async () => {
    const admin = await sesion('administrador');
    const manana = sumarDias(hoy(), 1);
    expect((await admin.get(`/api/reportes/ingresos?desde=${hoy()}&hasta=${manana}`)).body.campos.hasta).toBe('La fecha final no puede ser posterior a hoy');
    expect((await admin.get(`/api/admin/auditoria?desde=${hoy()}&hasta=${manana}`)).status).toBe(422);
    const insumo = (await prisma.insumo.findFirstOrThrow()).id;
    expect((await admin.get(`/api/insumos/${insumo}/kardex?hasta=${manana}`)).status).toBe(422);
    expect((await admin.get(`/api/insumos/${insumo}/kardex?desde=${hoy()}&hasta=${sumarDias(hoy(), -3)}`)).status).toBe(422);
    expect((await admin.get(`/api/reportes/ingresos?desde=${sumarDias(hoy(), -7)}&hasta=${hoy()}`)).status).toBe(200);
  });
});
