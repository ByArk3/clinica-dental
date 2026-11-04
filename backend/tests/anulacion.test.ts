// Anular un comprobante emitido por error
import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, idTipoPago, idTratamiento, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

let horasAtras = 1;
beforeEach(() => {
  horasAtras = 1;
});
async function atendida(tratamientos: string[], dni = '72458190') {
  const c = await crearCita({ horas: -horasAtras, estado: 'confirmada', dni });
  horasAtras += 1;
  const od = await sesion('odontologo');
  const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Prueba', tratamientos: await Promise.all(tratamientos.map(async (t) => ({ tratamientoId: await idTratamiento(t) }))) });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return c.id;
}
const cobrar = async (citaId: number) => {
  const r = await (await sesion('recepcionista')).post(`/api/caja/citas/${citaId}/comprobante`).send({ tipoPagoId: await idTipoPago('Tarjeta') });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
};
const MOTIVO = { motivo: 'Se cobró el tratamiento equivocado' };

describe('Anular comprobante de servicio', () => {
  it('queda «Anulado» con su número, la cita vuelve a «Atendida» y se emite el correcto con el número siguiente', async () => {
    const citaId = await atendida(['Profilaxis']);
    const c = await cobrar(citaId);
    const recep = await sesion('recepcionista');
    const r = await recep.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ numero: 'C-000001', estadoCita: 'atendida', anulado: { por: 'Ana Ríos', motivo: MOTIVO.motivo } });
    // vuelve a la lista de pendientes de caja
    expect((await recep.get('/api/caja/pendientes')).body.map((p: { citaId: number }) => p.citaId)).toContain(citaId);
    const nuevo = await cobrar(citaId);
    expect(nuevo.numero).toBe('C-000002');
    // la numeración no tiene huecos: el anulado sigue existiendo
    expect(await prisma.comprobante.count()).toBe(2);
    // auditoría
    const a = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'anular_comprobante' } });
    expect(a.detalle).toContain('C-000001');
    expect(a.detalle).toContain(MOTIVO.motivo);
  });

  it('el motivo es obligatorio; no se anula dos veces; no se envía por correo', async () => {
    const c = await cobrar(await atendida(['Profilaxis']));
    const recep = await sesion('recepcionista');
    expect((await recep.patch(`/api/comprobantes/${c.id}/anular`).send({ motivo: '' })).status).toBe(422);
    await recep.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    const otra = await recep.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    expect(otra.status).toBe(409);
    expect(otra.body.mensaje).toBe(MENSAJES.COMPROBANTE_YA_ANULADO);
    expect((await recep.post(`/api/comprobantes/${c.id}/enviar`)).body.mensaje).toBe(MENSAJES.COMPROBANTE_YA_ANULADO);
    // el PDF se sigue pudiendo ver (con el sello)
    const pdf = await recep.get(`/api/comprobantes/${c.id}/pdf`);
    expect(pdf.status).toBe(200);
  });

  it('recepcionista: solo los de hoy; el Administrador puede anular uno de otro día', async () => {
    const c = await cobrar(await atendida(['Profilaxis']));
    await prisma.comprobante.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const recep = await sesion('recepcionista');
    const r = await recep.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    expect(r.status).toBe(403);
    expect(r.body.mensaje).toBe(MENSAJES.ANULACION_SOLO_HOY);
    const admin = await sesion('administrador');
    expect((await admin.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO)).body.anulado.por).toBe('Carlos Vega');
    // el odontólogo no puede
    expect((await (await sesion('odontologo')).patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO)).status).toBe(403);
  });

  it('el saldo a favor usado vuelve al paciente', async () => {
    await prisma.paciente.update({ where: { dni: '72458190' }, data: { saldoFavor: 30 } });
    const c = await cobrar(await atendida(['Profilaxis'])); // 80 − 30 de saldo
    expect(c).toMatchObject({ saldoAplicado: '30.00', total: '50.00' });
    expect((await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).saldoFavor.toFixed(2)).toBe('0.00');
    await (await sesion('recepcionista')).patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    expect((await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).saldoFavor.toFixed(2)).toBe('30.00');
    const mov = await prisma.saldoMovimiento.findFirstOrThrow({ where: { tipo: 'reversion_anulacion' } });
    expect(mov.monto.toFixed(2)).toBe('30.00');
  });

  it('el saldo generado (sobrante del adelanto) se retira; si ya se usó en otro cobro, no se deja anular', async () => {
    // Adelanto de S/ 100 pagado; la atención cuesta S/ 40 → sobran S/ 60 de saldo a favor
    const citaId = await atendida(['Consulta']);
    const recep = await sesion('recepcionista');
    const adel = await prisma.comprobante.create({
      data: { numero: 'C-000001', tipo: 'adelanto', citaId, pacienteId: (await prisma.cita.findUniqueOrThrow({ where: { id: citaId } })).pacienteId, tipoPagoId: await idTipoPago('Efectivo'), subtotal: 100, total: 100, montoRecibido: 100, emitidoPorId: (await prisma.usuario.findFirstOrThrow({ where: { rol: 'recepcionista' } })).id },
    });
    expect(adel.numero).toBe('C-000001');
    const servicio = await cobrar(citaId);
    expect(servicio).toMatchObject({ adelantoAplicado: '40.00', total: '0.00', saldoGenerado: '60.00' });

    // usa S/ 60 del saldo en otra atención (Profilaxis S/ 80)
    const otra = await cobrar(await atendida(['Profilaxis']));
    expect(otra.saldoAplicado).toBe('60.00');
    const bloqueada = await recep.patch(`/api/comprobantes/${servicio.id}/anular`).send(MOTIVO);
    expect(bloqueada.status).toBe(409);
    expect(bloqueada.body.mensaje).toBe(MENSAJES.SALDO_YA_USADO);

    // anulando primero el más reciente, ya se puede
    expect((await recep.patch(`/api/comprobantes/${otra.id}/anular`).send(MOTIVO)).status).toBe(200);
    expect((await recep.patch(`/api/comprobantes/${servicio.id}/anular`).send(MOTIVO)).status).toBe(200);
    expect((await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).saldoFavor.toFixed(2)).toBe('0.00');
    // el cobro correcto vuelve a descontar el adelanto (que sigue vigente)
    expect((await recep.get(`/api/caja/citas/${citaId}/importe`)).body).toMatchObject({ adelantoAplicado: '40.00', sobrante: '60.00' });
  });
});

describe('Anular comprobante de adelanto', () => {
  it('cita futura: vuelve a «Pendiente de adelanto» con 1 hora nueva para pagar', async () => {
    const cita = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 40, venceEnMin: 30 });
    const recep = await sesion('recepcionista');
    const c = (await recep.post(`/api/caja/citas/${cita.id}/comprobante`).send({ tipoPagoId: await idTipoPago('Efectivo'), montoRecibido: 40 })).body;
    expect(c.estadoCita).toBe('confirmada');
    const r = await recep.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    expect(r.body.estadoCita).toBe('pendiente_adelanto');
    const despues = await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } });
    const min = (despues.adelantoVenceEn!.getTime() - Date.now()) / 60_000;
    expect(min).toBeGreaterThan(58);
    expect(min).toBeLessThanOrEqual(60);
    // se puede volver a cobrar
    expect((await recep.post(`/api/caja/citas/${cita.id}/comprobante`).send({ tipoPagoId: await idTipoPago('Efectivo'), montoRecibido: 40 })).status).toBe(201);
  });

  it('si la cita ya se cobró, primero se anula el comprobante del servicio', async () => {
    const citaId = await atendida(['Profilaxis']);
    const recepId = (await prisma.usuario.findFirstOrThrow({ where: { rol: 'recepcionista' } })).id;
    const pacienteId = (await prisma.cita.findUniqueOrThrow({ where: { id: citaId } })).pacienteId;
    const adel = await prisma.comprobante.create({ data: { numero: 'C-000001', tipo: 'adelanto', citaId, pacienteId, tipoPagoId: await idTipoPago('Efectivo'), subtotal: 40, total: 40, montoRecibido: 40, emitidoPorId: recepId } });
    const servicio = await cobrar(citaId);
    const recep = await sesion('recepcionista');
    const r = await recep.patch(`/api/comprobantes/${adel.id}/anular`).send(MOTIVO);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.ANULAR_SERVICIO_PRIMERO);
    await recep.patch(`/api/comprobantes/${servicio.id}/anular`).send(MOTIVO);
    // ahora sí; la cita sigue «Atendida» y el cobro ya no descuenta ese adelanto
    const ok = await recep.patch(`/api/comprobantes/${adel.id}/anular`).send(MOTIVO);
    expect(ok.body.estadoCita).toBe('atendida');
    expect((await recep.get(`/api/caja/citas/${citaId}/importe`)).body).toMatchObject({ adelantoAplicado: '0.00', total: '80.00' });
  });

  it('cita cancelada (el adelanto ya pasó a saldo o se devolvió): no se puede anular', async () => {
    const cita = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 40, venceEnMin: 30 });
    const recep = await sesion('recepcionista');
    const c = (await recep.post(`/api/caja/citas/${cita.id}/comprobante`).send({ tipoPagoId: await idTipoPago('Efectivo'), montoRecibido: 40 })).body;
    await recep.patch(`/api/citas/${cita.id}/cancelar`).send({});
    const r = await recep.patch(`/api/comprobantes/${c.id}/anular`).send(MOTIVO);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.ANULACION_CITA_PASADA);
  });
});

describe('Ingresos y lista del día', () => {
  it('los anulados no suman en el panel ni en el reporte, pero aparecen en el detalle con su motivo', async () => {
    const a = await cobrar(await atendida(['Profilaxis']));
    await cobrar(await atendida(['Consulta']));
    const recep = await sesion('recepcionista');
    await recep.patch(`/api/comprobantes/${a.id}/anular`).send(MOTIVO);
    const admin = await sesion('administrador');
    const panel = (await admin.get('/api/panel')).body;
    expect(panel.ingresos).toMatchObject({ hoy: '40.00', comprobantesHoy: 1 });
    const rep = (await admin.get('/api/reportes/ingresos')).body;
    expect(rep.resumen).toMatchObject({ total: '40.00', comprobantes: 1, anulados: 1 });
    expect(rep.detalle.find((d: { numero: string }) => d.numero === 'C-000001').anulado.motivo).toBe(MOTIVO.motivo);

    const hoy = (await recep.get('/api/caja/comprobantes')).body;
    expect(hoy.map((c: { numero: string; puedeAnular: boolean }) => [c.numero, c.puedeAnular])).toEqual([['C-000002', true], ['C-000001', false]]);
  });
});
