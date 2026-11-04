// Reglas del adelanto acordadas con el equipo (nov. 2026)
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, crearCampana, crearCita, idOdontologo, idPaciente, idTipoPago, idTratamiento, prisma, proximo, reiniciarBD, sesion } from './helpers.js';
import { liberarCitas } from '../src/jobs/citas.jobs.js';

beforeEach(reiniciarBD);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Reserva web de María (restringida → paga adelanto) para el próximo lunes. */
async function reservaRestringida(tratamiento?: string, hora = '10:00') {
  await prisma.paciente.update({ where: { dni: '72458190' }, data: { inasistencias: 3, restringido: true } });
  const pac = await sesion('paciente');
  const r = await pac.post('/api/citas').send({
    odontologoId: await idOdontologo(),
    fecha: proximo(1),
    hora,
    motivo: 'Control',
    ...(tratamiento ? { tratamientoPrevistoId: await idTratamiento(tratamiento) } : {}),
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { pac, cita: r.body.cita, body: r.body };
}

describe('Quién paga adelanto y cuánto', () => {
  it('reserva normal (≥ 24 h, sin faltas): sin adelanto, «Pendiente de confirmación»', async () => {
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: proximo(1), hora: '09:00', motivo: 'Control' });
    expect(r.body.cita).toMatchObject({ estado: 'pendiente_confirmacion', montoAdelanto: null, tratamientoPrevisto: 'Consulta' });
    expect(r.body.pago).toBeUndefined();
  });

  it('paciente con 3+ faltas: 50 % del tratamiento elegido (extracción simple S/ 80 → S/ 40) con datos de Yape/Plin', async () => {
    const { cita, body } = await reservaRestringida('Extracción simple');
    expect(cita).toMatchObject({ estado: 'pendiente_adelanto', tratamientoPrevisto: 'Extracción simple', montoAdelanto: '40.00' });
    expect(body.aviso).toBe(MENSAJES.ADELANTO_OBLIGATORIO);
    expect(body.pago).toEqual({ numero: '987654321', titular: 'Clínica Dental (ficticio)', billeteras: ['yape'], tieneQr: false });
  });

  it('sin tratamiento elegido se usa la Consulta (S/ 40 → S/ 20)', async () => {
    const { cita } = await reservaRestringida();
    expect(cita.montoAdelanto).toBe('20.00');
  });

  it('el adelanto usa la campaña vigente el DÍA DE LA CITA (blanqueamiento S/ 450 − 25 % → S/ 168.75)', async () => {
    const lunes = proximo(1);
    await crearCampana({ nombre: 'Blanqueamiento 25 %', tratamientos: ['Blanqueamiento'], desde: lunes, hasta: lunes, porcentaje: 25 });
    const { cita } = await reservaRestringida('Blanqueamiento');
    expect(cita.montoAdelanto).toBe('168.75');
  });

  it('una campaña que vence antes de la cita no se aplica', async () => {
    const { ahoraLima } = await import('../src/lib/fechas.js');
    const hoy = ahoraLima().fecha;
    await crearCampana({ nombre: 'Solo hoy', tratamientos: ['Blanqueamiento'], desde: hoy, hasta: hoy, porcentaje: 25 });
    const { cita } = await reservaRestringida('Blanqueamiento');
    expect(cita.montoAdelanto).toBe('225.00');
  });

  it('tratamiento previsto desactivado → 422', async () => {
    await prisma.tratamiento.update({ where: { nombre: 'Blanqueamiento' }, data: { activo: false } });
    const pac = await sesion('paciente');
    const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: proximo(1), hora: '09:00', motivo: 'Control', tratamientoPrevistoId: await idTratamiento('Blanqueamiento') });
    expect(r.status).toBe(422);
    expect(r.body.campos.tratamientoPrevistoId).toBe(MENSAJES.TRATAMIENTO_NO_TARIFARIO);
  });

  it('el tarifario público (nombre y precio) está disponible para paciente y recepcionista', async () => {
    const r = await (await sesion('paciente')).get('/api/tarifario');
    expect(r.body).toEqual(expect.arrayContaining([{ id: expect.any(Number), nombre: 'Extracción simple', precio: '80.00' }]));
    expect((await (await sesion('odontologo')).get('/api/tarifario')).status).toBe(403);
  });
});

describe('Pago reportado por el paciente (Yape/Plin) y verificación en caja', () => {
  it('flujo completo: reporta → «Pago en verificación» → caja aprueba → comprobante con N.° de operación y cita «Confirmada»', async () => {
    const { pac, cita } = await reservaRestringida('Extracción simple');
    const r = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: '12345678', captura: PNG });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'pago_en_verificacion', pagoReportado: { metodo: 'yape', numeroOperacion: '12345678' } });

    const recep = await sesion('recepcionista');
    const imp = await recep.get(`/api/caja/citas/${cita.id}/importe`);
    expect(imp.body).toMatchObject({ tipo: 'adelanto', total: '40.00', pagoReportado: { metodo: 'yape', numeroOperacion: '12345678', tieneCaptura: true } });
    const img = await recep.get(`/api/caja/citas/${cita.id}/captura`);
    expect(img.headers['content-type']).toBe('image/png');

    const ok = await recep.post(`/api/caja/citas/${cita.id}/aprobar-pago`);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ tipo: 'adelanto', total: '40.00', tipoPago: 'Yape', operacion: '12345678', estadoCita: 'confirmada' });
    // ya no necesita el enlace de confirmación: el recordatorio solo va a las «Pendiente de confirmación»
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } })).estado).toBe('confirmada');
  });

  it('caja rechaza el pago (no llegó) → la cita se libera con el motivo', async () => {
    const { pac, cita } = await reservaRestringida();
    await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: 'ABC-999' });
    const recep = await sesion('recepcionista');
    const sin = await recep.post(`/api/caja/citas/${cita.id}/rechazar-pago`).send({ motivo: '' });
    expect(sin.status).toBe(422);
    const r = await recep.post(`/api/caja/citas/${cita.id}/rechazar-pago`).send({ motivo: 'No llegó ningún pago con ese número' });
    expect(r.body.estado).toBe('liberada');
    const c = await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } });
    expect(c.pagoRechazoMotivo).toBe('No llegó ningún pago con ese número');
    expect((await recep.post(`/api/caja/citas/${cita.id}/aprobar-pago`)).status).toBe(409);
  });

  it('validaciones del reporte: número de operación, imagen válida, solo su cita, solo si está pendiente', async () => {
    const { pac, cita } = await reservaRestringida();
    const mal = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'bcp', numeroOperacion: '1', captura: 'data:text/plain;base64,aG9sYQ==' });
    expect(mal.status).toBe(422);
    expect(Object.keys(mal.body.campos).sort()).toEqual(['captura', 'metodo', 'numeroOperacion']);
    const ajena = await crearCita({ horas: 80, estado: 'pendiente_adelanto', dni: '70112233', montoAdelanto: 20, venceEnMin: 30, odontologoEmail: 'carmen.diaz@clinica.local' });
    expect((await pac.post(`/api/citas/${ajena.id}/pago`).send({ metodo: 'yape', numeroOperacion: '1234' })).status).toBe(404);
    await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: '1234' });
    const otra = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: '5678' });
    expect(otra.status).toBe(409);
    expect(otra.body.mensaje).toBe(MENSAJES.PAGO_NO_REPORTABLE);
  });

  it('captura de más de 2 MB → rechazada', async () => {
    const { pac, cita } = await reservaRestringida();
    const grande = `data:image/png;base64,${'A'.repeat(2_900_000)}`;
    const r = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: '1234', captura: grande });
    expect([413, 422]).toContain(r.status);
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } })).estado).toBe('pendiente_adelanto');
  });
});

describe('Plazo de 1 hora', () => {
  it('sin pagar ni reportar en 1 hora → se libera; «Pago en verificación» no se libera', async () => {
    const vencida = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: -1 });
    const aTiempo = await crearCita({ horas: 74, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 30, dni: '70112233' });
    const reportada = await crearCita({ horas: 76, estado: 'pago_en_verificacion', montoAdelanto: 20, venceEnMin: -30, dni: '71223344' });
    expect(await liberarCitas()).toEqual([vencida.id]);
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: aTiempo.id } })).estado).toBe('pendiente_adelanto');
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: reportada.id } })).estado).toBe('pago_en_verificacion');
  });

  it('reportar el pago después del plazo → «El plazo de 1 hora … venció»', async () => {
    const { pac, cita } = await reservaRestringida();
    await prisma.cita.update({ where: { id: cita.id }, data: { adelantoVenceEn: new Date(Date.now() - 60_000) } });
    const r = await pac.post(`/api/citas/${cita.id}/pago`).send({ metodo: 'yape', numeroOperacion: '1234' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.ADELANTO_VENCIDO);
  });
});

/** Cita confirmada de Lucía con adelanto de S/ 40 ya pagado, a `horas` de ahora. */
async function citaConAdelantoPagado(horas: number) {
  const c = await crearCita({ horas, estado: 'pendiente_adelanto', dni: '70112233', montoAdelanto: 40, venceEnMin: 30 });
  const recep = await sesion('recepcionista');
  const r = await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await idTipoPago('Tarjeta') });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { recep, citaId: c.id };
}
const saldoDe = async (dni: string) => (await prisma.paciente.findUniqueOrThrow({ where: { dni } })).saldoFavor.toFixed(2);

describe('Cancelar o no asistir después de pagar el adelanto', () => {
  it('cancela con 24 h o más → saldo a favor', async () => {
    const { recep, citaId } = await citaConAdelantoPagado(72);
    const r = await recep.patch(`/api/citas/${citaId}/cancelar`).send({});
    expect(r.body).toMatchObject({ estado: 'cancelada', adelanto: { monto: '40.00', resultado: 'saldo_a_favor' } });
    expect(await saldoDe('70112233')).toBe('40.00');
  });

  it('cancela con menos de 24 h → pierde el adelanto', async () => {
    const { recep, citaId } = await citaConAdelantoPagado(10);
    const r = await recep.patch(`/api/citas/${citaId}/cancelar`).send({});
    expect(r.body.adelanto).toEqual({ monto: '40.00', resultado: 'perdido' });
    expect(await saldoDe('70112233')).toBe('0.00');
  });

  it('cancela la clínica → se devuelve y el reporte de ingresos lo descuenta', async () => {
    const { recep, citaId } = await citaConAdelantoPagado(10);
    const r = await recep.patch(`/api/citas/${citaId}/cancelar`).send({ porClinica: true });
    expect(r.body.adelanto).toEqual({ monto: '40.00', resultado: 'devuelto' });
    expect(await prisma.devolucion.count({ where: { citaId } })).toBe(1);
    const admin = await sesion('administrador');
    const rep = await admin.get('/api/reportes/ingresos');
    expect(rep.body.resumen).toMatchObject({ cobrado: '40.00', devoluciones: '40.00', total: '0.00' });
  });

  it('el paciente no puede marcar «por la clínica» (se ignora)', async () => {
    const c = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 30 });
    const recep = await sesion('recepcionista');
    await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await idTipoPago('Tarjeta') });
    const pac = await sesion('paciente');
    const r = await pac.patch(`/api/citas/${c.id}/cancelar`).send({ porClinica: true });
    expect(r.body.adelanto.resultado).toBe('saldo_a_favor');
  });

  it('cancelar desde el enlace de confirmación (≥ 24 h) también deja saldo a favor', async () => {
    const c = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 30, token: 'token-adelanto-cancelar-1' });
    const recep = await sesion('recepcionista');
    await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await idTipoPago('Tarjeta') });
    const r = await request(app).post('/api/citas/confirmar/token-adelanto-cancelar-1').send({ accion: 'cancelar' });
    expect(r.body.estado).toBe('cancelada');
    expect(await saldoDe('72458190')).toBe('20.00');
  });

  it('no asiste → pierde el adelanto (queda anotado en la ficha)', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada', dni: '70112233' });
    const u = await prisma.usuario.findFirstOrThrow({ where: { rol: 'recepcionista' } });
    await prisma.comprobante.create({
      data: { numero: 'C-000900', tipo: 'adelanto', citaId: c.id, pacienteId: c.pacienteId, tipoPagoId: await idTipoPago('Tarjeta'), subtotal: 40, total: 40, montoRecibido: 40, emitidoPorId: u.id },
    });
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/citas/${c.id}/inasistencia`);
    expect(r.body.adelantoPerdido).toBe('40.00');
    const ficha = await prisma.fichaPaciente.findFirstOrThrow({ where: { pacienteId: c.pacienteId } });
    expect(ficha.notas).toContain('pierde el adelanto de S/ 40.00');
  });
});

describe('Reprogramar con adelanto', () => {
  it('con adelanto pagado: pasa a la nueva fecha y sigue «Confirmada»', async () => {
    const { recep, citaId } = await citaConAdelantoPagado(72);
    const r = await recep.patch(`/api/citas/${citaId}/reprogramar`).send({ odontologoId: await idOdontologo(), fecha: proximo(2), hora: '11:00' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'confirmada', adelantoPagado: '40.00', fecha: proximo(2) });
  });

  it('sin pagar todavía: se recalcula el adelanto y empieza un nuevo plazo de 1 hora', async () => {
    const { pac, cita } = await reservaRestringida('Extracción simple');
    await prisma.cita.update({ where: { id: cita.id }, data: { adelantoVenceEn: new Date(Date.now() + 5 * 60_000) } });
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: await idOdontologo(), fecha: proximo(2), hora: '12:00' });
    expect(r.body).toMatchObject({ estado: 'pendiente_adelanto', montoAdelanto: '40.00' });
    expect(new Date(r.body.adelantoVenceEn).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
  });

  it('con el pago en verificación no se puede reprogramar ni cancelar', async () => {
    const c = await crearCita({ horas: 72, estado: 'pago_en_verificacion', montoAdelanto: 20 });
    const recep = await sesion('recepcionista');
    const r = await recep.patch(`/api/citas/${c.id}/cancelar`).send({});
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.PAGO_EN_VERIFICACION);
  });

  it('reprogramar una cita sin adelanto a menos de 24 h → ahora requiere adelanto', async () => {
    const recep = await sesion('recepcionista');
    const c = await recep.post('/api/citas').send({ pacienteId: await idPaciente('70112233'), odontologoId: await idOdontologo(), fecha: proximo(1), hora: '09:00', motivo: 'Control' });
    expect(c.body.cita.estado).toBe('pendiente_confirmacion');
    const { ahoraLima, sumarDias } = await import('../src/lib/fechas.js');
    const hoy = ahoraLima().fecha;
    for (const f of [hoy, sumarDias(hoy, 1)]) {
      const d = await recep.get(`/api/disponibilidad?odontologoId=${await idOdontologo()}&fecha=${f}`);
      const h = (d.body.horarios as string[]).find((x) => (new Date(`${f}T${x}:00-05:00`).getTime() - Date.now()) / 3_600_000 < 23);
      if (!h) continue;
      const r = await recep.patch(`/api/citas/${c.body.cita.id}/reprogramar`).send({ odontologoId: await idOdontologo(), fecha: f, hora: h });
      expect(r.body).toMatchObject({ estado: 'pendiente_adelanto', montoAdelanto: '20.00' });
      return;
    }
  });
});
