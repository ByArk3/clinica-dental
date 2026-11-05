import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, prisma, reiniciarBD, sesion } from './helpers.js';
import { dateAFecha } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

const idTrat = async (nombre: string) => (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre } })).id;
const stock = async (nombre: string) => (await prisma.insumo.findUniqueOrThrow({ where: { nombre } })).stockActual.toFixed(2);

describe('CU-11 Mis citas del día', () => {
  it('lista solo las citas del odontólogo en sesión, con alergias y si se puede atender', async () => {
    const mia = await crearCita({ horas: -1, estado: 'confirmada' });
    await crearCita({ horas: -1, estado: 'confirmada', odontologoEmail: 'carmen.diaz@clinica.local', dni: '70112233' });
    await crearCita({ horas: 2, estado: 'pendiente_confirmacion', dni: '71223344' }); // no confirmada: no aparece
    const od = await sesion('odontologo');
    const r = await od.get(`/api/odontologos/me/citas?fecha=${dateAFecha(mia.fecha)}`);
    expect(r.status).toBe(200);
    expect(r.body.map((c: { id: number }) => c.id)).toEqual([mia.id]);
    expect(r.body[0]).toMatchObject({ puedeAtender: true, paciente: { nombres: 'María', alergias: 'Penicilina' } });
  });
});

describe('CU-11 Registrar tratamiento', () => {
  it('flujo básico: crea la atención con precio congelado, cita → «Atendida» y descuenta insumos', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({
      diagnostico: 'Caries oclusal en 16',
      observaciones: 'Control en 6 meses',
      tratamientos: [{ tratamientoId: await idTrat('Curación con resina'), piezaDental: '16' }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ estado: 'atendida', total: '120.00' });
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('atendida');
    const at = await prisma.atencion.findUniqueOrThrow({ where: { citaId: c.id }, include: { tratamientos: true } });
    expect(at.tratamientos[0]).toMatchObject({ piezaDental: '16' });
    expect(at.tratamientos[0].precioAplicado.toFixed(2)).toBe('120.00');
    // Resina 5→4, Anestesia 18→17, Guantes 7→6
    expect(await stock('Resina compuesta A2')).toBe('4.00');
    expect(await stock('Anestesia lidocaína 2 %')).toBe('17.00');
    expect(await stock('Guantes de nitrilo M')).toBe('6.00');
    const kardex = await prisma.movimientoKardex.findMany({ where: { referenciaTipo: 'atencion', referenciaId: at.id } });
    expect(kardex).toHaveLength(3);
    // RN-14: resina (4 ≤ 5) y guantes (6 ≤ 10) quedan en alerta
    // ya tenían su alerta abierta desde la semilla: no se duplica (RN-14)
    expect(r.body.alertas).toEqual([]);
    expect(await prisma.alertaStock.count({ where: { revisada: false, insumo: { nombre: { in: ['Guantes de nitrilo M', 'Resina compuesta A2'] } } } })).toBe(2);
  });

  it('5.1: varios tratamientos → descuenta los insumos de cada uno (sumados)', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({
      diagnostico: 'Caries y placa',
      tratamientos: [
        { tratamientoId: await idTrat('Curación con resina'), piezaDental: '26' },
        { tratamientoId: await idTrat('Profilaxis') },
        { tratamientoId: await idTrat('Consulta') },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe('240.00');
    expect(await stock('Guantes de nitrilo M')).toBe('5.00'); // 7 − 1 (curación) − 1 (consulta)
    expect(await stock('Copa de goma')).toBe('11.00');
    expect(await stock('Pasta profiláctica')).toBe('5.00');
  });

  it('el mismo tratamiento en dos piezas se registra y descuenta dos veces', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const id = await idTrat('Curación con resina');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Caries', tratamientos: [{ tratamientoId: id, piezaDental: '16' }, { tratamientoId: id, piezaDental: '17' }] });
    expect(r.body.total).toBe('240.00');
    expect(await stock('Resina compuesta A2')).toBe('3.00');
  });

  it('CU-12: si un insumo no alcanza, queda en 0 y se informa el faltante', async () => {
    await prisma.insumo.update({ where: { nombre: 'Gel blanqueador' }, data: { stockActual: 0 } });
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Pigmentación', tratamientos: [{ tratamientoId: await idTrat('Blanqueamiento') }] });
    expect(r.status).toBe(201);
    expect(r.body.insumos.find((i: { insumo: string }) => i.insumo === 'Gel blanqueador')).toMatchObject({ saldo: '0.00', faltante: '1.00' });
  });

  it('el cambio de precio del tarifario NO altera atenciones ya registradas (CU-16)', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const id = await idTrat('Profilaxis');
    await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Placa', tratamientos: [{ tratamientoId: id }] });
    await prisma.tratamiento.update({ where: { id }, data: { precio: 150 } });
    const at = await prisma.atencionTratamiento.findFirstOrThrow({ where: { tratamientoId: id } });
    expect(at.precioAplicado.toFixed(2)).toBe('80.00');
  });

  it('6.1: faltan obligatorios → 422 con los campos, y no se guarda nada', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: '', tratamientos: [] });
    expect(r.status).toBe(422);
    expect(r.body.campos).toMatchObject({ diagnostico: 'Ingrese el diagnóstico', tratamientos: 'Agregue al menos un tratamiento' });
    expect(await prisma.atencion.count()).toBe(0);
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('confirmada');
  });

  it('pieza dental fuera de FDI 11–48 → 422', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Caries', tratamientos: [{ tratamientoId: await idTrat('Consulta'), piezaDental: '19' }] });
    expect(r.status).toBe(422);
    expect(r.body.campos['tratamientos.0.piezaDental']).toBe('Pieza dental inválida (FDI 11–48)');
  });

  it('RN-08: tratamiento desactivado → 422 y la transacción no deja rastro (ni stock ni estado)', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    await prisma.tratamiento.update({ where: { nombre: 'Extracción simple' }, data: { activo: false } });
    const od = await sesion('odontologo');
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({
      diagnostico: 'Resto radicular',
      tratamientos: [{ tratamientoId: await idTrat('Consulta') }, { tratamientoId: await idTrat('Extracción simple') }],
    });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.TRATAMIENTO_NO_TARIFARIO);
    expect(await stock('Guantes de nitrilo M')).toBe('7.00');
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('confirmada');
  });

  it('RN-06: otro odontólogo, cita no confirmada, ya atendida o de un día futuro → 409', async () => {
    const consulta = await idTrat('Consulta');
    const datos = { diagnostico: 'Control', tratamientos: [{ tratamientoId: consulta }] };
    const od = await sesion('odontologo');
    const ajena = await crearCita({ horas: -1, estado: 'confirmada', odontologoEmail: 'carmen.diaz@clinica.local' });
    const pendiente = await crearCita({ horas: -2, estado: 'pendiente_confirmacion' });
    const futura = await crearCita({ horas: 50, estado: 'confirmada' });
    for (const c of [ajena, pendiente, futura]) {
      const r = await od.post(`/api/citas/${c.id}/atencion`).send(datos);
      expect(r.status).toBe(409);
      expect(r.body.mensaje).toBe(MENSAJES.CITA_NO_ATENCION);
    }
    const ok = await crearCita({ horas: -3, estado: 'confirmada', dni: '70112233' });
    expect((await od.post(`/api/citas/${ok.id}/atencion`).send(datos)).status).toBe(201);
    expect((await od.post(`/api/citas/${ok.id}/atencion`).send(datos)).status).toBe(409); // dos veces no
  });

  it('RN-06: solo el odontólogo registra atenciones', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    for (const rol of ['administrador', 'recepcionista', 'paciente'] as const) {
      expect((await (await sesion(rol)).post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'x', tratamientos: [] })).status).toBe(403);
    }
  });
});

describe('CU-10 Consultar historial clínico', () => {
  it('flujo básico: busca por DNI o nombre, y muestra ficha y atenciones de la más reciente a la más antigua', async () => {
    const od = await sesion('odontologo');
    const consulta = await idTrat('Consulta');
    const vieja = await crearCita({ horas: -30, estado: 'confirmada' });
    const nueva = await crearCita({ horas: -2, estado: 'confirmada' });
    await od.post(`/api/citas/${vieja.id}/atencion`).send({ diagnostico: 'Primera', tratamientos: [{ tratamientoId: consulta }] });
    await od.post(`/api/citas/${nueva.id}/atencion`).send({ diagnostico: 'Segunda', tratamientos: [{ tratamientoId: consulta, piezaDental: '11' }] });

    const admin = await sesion('administrador');
    const porDni = await admin.get('/api/pacientes/buscar?q=72458190');
    expect(porDni.body).toEqual([expect.objectContaining({ nombres: 'María', atenciones: 2 })]);
    const porNombre = await admin.get('/api/pacientes/buscar?q=quispe mar');
    expect(porNombre.body.map((p: { dni: string }) => p.dni)).toEqual(['72458190']);

    const h = await admin.get(`/api/pacientes/${porDni.body[0].id}/historial`);
    expect(h.status).toBe(200);
    expect(h.body.ficha.alergias).toBe('Penicilina');
    expect(h.body.atenciones.map((a: { diagnostico: string }) => a.diagnostico)).toEqual(['Segunda', 'Primera']);
    expect(h.body.atenciones[0]).toMatchObject({ odontologo: 'Dr. Luis Paredes', tratamientos: [{ nombre: 'Consulta', piezaDental: '11', precio: '40.00' }] });
    expect(h.body.mensaje).toBeUndefined();
  });

  it('2.1: sin coincidencias → «Paciente no encontrado»', async () => {
    const od = await sesion('odontologo');
    const r = await od.get('/api/pacientes/buscar?q=Zzzz');
    expect(r.status).toBe(404);
    expect(r.body.mensaje).toBe(MENSAJES.PACIENTE_NO_ENCONTRADO);
  });

  it('4.1 / RN-07: recepcionista y paciente → «No tiene permiso para ver el historial clínico»', async () => {
    for (const rol of ['recepcionista', 'paciente'] as const) {
      const ag = await sesion(rol);
      const r = await ag.get('/api/pacientes/1/historial');
      expect(r.status).toBe(403);
      expect(r.body.mensaje).toBe(MENSAJES.SIN_PERMISO_HISTORIAL);
      expect((await ag.get('/api/pacientes/buscar?q=maria')).status).toBe(403);
    }
  });

  it('5.1: sin atenciones → ficha + «El paciente no tiene atenciones registradas»', async () => {
    const od = await sesion('odontologo');
    const id = (await prisma.paciente.findUniqueOrThrow({ where: { dni: '74556677' } })).id;
    const r = await od.get(`/api/pacientes/${id}/historial`);
    expect(r.body).toMatchObject({ atenciones: [], mensaje: MENSAJES.SIN_ATENCIONES });
  });

  it('la búsqueda exige al menos 2 caracteres', async () => {
    const od = await sesion('odontologo');
    expect((await od.get('/api/pacientes/buscar?q=a')).status).toBe(422);
  });

  it('incluye las notas de inasistencias de la ficha', async () => {
    await prisma.fichaPaciente.updateMany({ where: { paciente: { dni: '72458190' } }, data: { notas: '01/11/2026 10:00: inasistencia (1.ª)' } });
    const od = await sesion('odontologo');
    const id = (await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).id;
    expect((await od.get(`/api/pacientes/${id}/historial`)).body.ficha.notas).toContain('inasistencia');
  });
});
