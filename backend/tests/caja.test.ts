import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCampana, crearCita, idOdontologo, idTratamiento, prisma, proximo, reiniciarBD, sesion } from './helpers.js';
import { ahoraLima, sumarDias } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

const idTrat = async (nombre: string) => (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre } })).id;
const tipoPago = async (nombre: string) => (await prisma.tipoPago.findUniqueOrThrow({ where: { nombre } })).id;

/** Crea una cita confirmada en el pasado y registra su atención. Cada llamada usa otra hora (RN-02). */
let horasAtras = 1;
beforeEach(() => {
  horasAtras = 1;
});
async function citaAtendida(tratamientos: string[], dni = '72458190') {
  const c = await crearCita({ horas: -horasAtras, estado: 'confirmada', dni });
  horasAtras += 1;
  const od = await sesion('odontologo');
  const r = await od.post(`/api/citas/${c.id}/atencion`).send({
    diagnostico: 'Diagnóstico de prueba',
    tratamientos: await Promise.all(tratamientos.map(async (n) => ({ tratamientoId: await idTrat(n) }))),
  });
  if (r.status !== 201) throw new Error(`atención: ${r.status} ${JSON.stringify(r.body)}`);
  return c.id;
}

describe('CU-13 Caja: pendientes e importe', () => {
  it('1: lista citas «Atendida» por cobrar, adelantos pendientes y pagos por verificar; no los vencidos', async () => {
    const atendida = await citaAtendida(['Profilaxis']);
    const adelanto = await crearCita({ horas: 72, estado: 'pendiente_adelanto', dni: '73445566', odontologoEmail: 'carmen.diaz@clinica.local', montoAdelanto: 20, venceEnMin: 50 });
    const reportado = await crearCita({ horas: 80, estado: 'pago_en_verificacion', dni: '71223344', odontologoEmail: 'carmen.diaz@clinica.local', montoAdelanto: 40 });
    await crearCita({ horas: 90, estado: 'pendiente_adelanto', dni: '74556677', odontologoEmail: 'carmen.diaz@clinica.local', montoAdelanto: 20, venceEnMin: -5 }); // venció
    const recep = await sesion('recepcionista');
    const r = await recep.get('/api/caja/pendientes');
    expect(r.status).toBe(200);
    expect(r.body.map((p: { citaId: number }) => p.citaId).sort()).toEqual([atendida, adelanto.id, reportado.id].sort());
    expect(r.body.find((p: { citaId: number }) => p.citaId === adelanto.id)).toMatchObject({ tipo: 'adelanto', importe: '20.00', estado: 'pendiente_adelanto' });
    expect(r.body.find((p: { citaId: number }) => p.citaId === atendida)).toMatchObject({ tipo: 'servicio', importe: '80.00' });
  });

  it('2 / RN-10: importe = Σ precios congelados en la atención (aunque luego cambie el tarifario)', async () => {
    const id = await citaAtendida(['Curación con resina', 'Profilaxis']);
    await prisma.tratamiento.update({ where: { nombre: 'Profilaxis' }, data: { precio: 999 } });
    const recep = await sesion('recepcionista');
    const r = await recep.get(`/api/caja/citas/${id}/importe`);
    expect(r.body).toMatchObject({ tipo: 'servicio', subtotal: '200.00', descuento: '0.00', adelantoAplicado: '0.00', saldoAplicado: '0.00', total: '200.00' });
    expect(r.body.lineas.map((l: { descripcion: string; precio: string }) => [l.descripcion, l.precio])).toEqual([
      ['Curación con resina', '120.00'],
      ['Profilaxis', '80.00'],
    ]);
  });

  it('4.1: tratamiento sin precio → detiene el cobro', async () => {
    const id = await citaAtendida(['Consulta']);
    await prisma.atencionTratamiento.updateMany({ data: { precioAplicado: 0 } });
    const recep = await sesion('recepcionista');
    const r = await recep.get(`/api/caja/citas/${id}/importe`);
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.TRATAMIENTO_SIN_PRECIO);
  });

  it('cita sin cobro pendiente (confirmada, pagada, cancelada) → 409', async () => {
    const c = await crearCita({ horas: 30, estado: 'confirmada' });
    const recep = await sesion('recepcionista');
    const r = await recep.get(`/api/caja/citas/${c.id}/importe`);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.CITA_SIN_COBRO);
  });
});

describe('CU-13 Emitir comprobante', () => {
  it('flujo básico (efectivo): comprobante C-000001 con detalle, vuelto y cita «Pagada»', async () => {
    const id = await citaAtendida(['Curación con resina']);
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), montoRecibido: 150 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      numero: 'C-000001',
      tipo: 'servicio',
      estadoCita: 'pagada',
      tipoPago: 'Efectivo',
      subtotal: '120.00',
      total: '120.00',
      montoRecibido: '150.00',
      vuelto: '30.00',
      emitidoPor: 'Ana Ríos',
      paciente: { nombres: 'María', tieneCorreo: true },
      lineas: [{ descripcion: 'Curación con resina', precio: '120.00', descuento: '0.00', campana: null }],
    });
    const c = await prisma.comprobante.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(c.citaId).toBe(id); // RN-11
    expect((await recep.get('/api/caja/pendientes')).body).toEqual([]);
  });

  it('tarjeta o Yape/Plin: se cobra el total exacto, sin vuelto', async () => {
    const id = await citaAtendida(['Profilaxis']);
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Yape'), montoRecibido: 500 });
    expect(r.body).toMatchObject({ total: '80.00', montoRecibido: '80.00', vuelto: '0.00' });
  });

  it('6.1: monto insuficiente en efectivo → 422 y no se registra nada', async () => {
    const id = await citaAtendida(['Profilaxis']);
    const recep = await sesion('recepcionista');
    for (const body of [{ montoRecibido: 79.99 }, {}]) {
      const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), ...body });
      expect(r.status).toBe(422);
      expect(r.body.mensaje).toBe(MENSAJES.MONTO_INSUFICIENTE);
    }
    expect(await prisma.comprobante.count()).toBe(0);
    expect((await prisma.cita.findUniqueOrThrow({ where: { id } })).estado).toBe('atendida');
  });

  it('con campaña vigente el día de la cita: el comprobante guarda el descuento por línea', async () => {
    const id = await citaAtendida(['Curación con resina', 'Profilaxis']);
    const hoy = ahoraLima().fecha;
    await crearCampana({ nombre: 'Limpieza 20 %', tratamientos: ['Profilaxis'], desde: sumarDias(hoy, -3), hasta: sumarDias(hoy, 3), porcentaje: 20 });
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    expect(r.body).toMatchObject({ subtotal: '200.00', descuento: '16.00', total: '184.00' });
    expect(r.body.lineas).toEqual([
      { descripcion: 'Curación con resina', precio: '120.00', descuento: '0.00', campana: null },
      { descripcion: 'Profilaxis', precio: '80.00', descuento: '16.00', campana: 'Limpieza 20 %' },
    ]);
  });

  it('no se cobra dos veces la misma cita; el correlativo no tiene huecos', async () => {
    const a = await citaAtendida(['Consulta']);
    const b = await citaAtendida(['Consulta'], '70112233');
    const recep = await sesion('recepcionista');
    const tarjeta = await tipoPago('Tarjeta');
    expect((await recep.post(`/api/caja/citas/${a}/comprobante`).send({ tipoPagoId: tarjeta })).body.numero).toBe('C-000001');
    const otra = await recep.post(`/api/caja/citas/${a}/comprobante`).send({ tipoPagoId: tarjeta });
    expect(otra.status).toBe(409);
    expect(otra.body.mensaje).toBe(MENSAJES.CITA_SIN_COBRO);
    expect((await recep.post(`/api/caja/citas/${b}/comprobante`).send({ tipoPagoId: tarjeta })).body.numero).toBe('C-000002');
  });

  it('cobros simultáneos: de la misma cita solo uno; de citas distintas, números únicos y seguidos', async () => {
    const recep = await sesion('recepcionista');
    const tarjeta = await tipoPago('Tarjeta');
    const misma = await citaAtendida(['Consulta']);
    const dobles = await Promise.all([1, 2].map(() => recep.post(`/api/caja/citas/${misma}/comprobante`).send({ tipoPagoId: tarjeta })));
    expect(dobles.map((r) => r.status).sort()).toEqual([201, 409]);

    const ids = [await citaAtendida(['Consulta'], '70112233'), await citaAtendida(['Consulta'], '71223344'), await citaAtendida(['Consulta'], '72334455')];
    const r = await Promise.all(ids.map((id) => recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: tarjeta })));
    expect(r.map((x) => x.body.numero).sort()).toEqual(['C-000002', 'C-000003', 'C-000004']);
  });

  it('tipo de pago inexistente → 422', async () => {
    const id = await citaAtendida(['Consulta']);
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: 999 });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.TIPO_PAGO_NO_VALIDO);
  });

  it('la base de datos rechaza un comprobante con montos incoherentes (CHECK)', async () => {
    const id = await citaAtendida(['Consulta']);
    const p = await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } });
    const u = await prisma.usuario.findFirstOrThrow({ where: { rol: 'recepcionista' } });
    await expect(
      prisma.comprobante.create({
        data: { numero: 'C-999999', citaId: id, pacienteId: p.id, tipoPagoId: await tipoPago('Efectivo'), subtotal: 40, descuento: 0, total: 30, montoRecibido: 40, vuelto: 10, emitidoPorId: u.id },
      }),
    ).rejects.toThrow();
  });
});

describe('CU-13 3.1 Adelanto en caja (50 % del tratamiento previsto)', () => {
  it('cobra el adelanto en la clínica → la cita queda «Confirmada» y se descuenta en el cobro final', async () => {
    const recep = await sesion('recepcionista');
    const pedro = (await prisma.paciente.findUniqueOrThrow({ where: { dni: '73445566' } })).id;
    const reserva = await recep.post('/api/citas').send({ pacienteId: pedro, odontologoId: await idOdontologo(), fecha: proximo(1), hora: '10:00', motivo: 'Control' });
    expect(reserva.body.cita).toMatchObject({ estado: 'pendiente_adelanto', tratamientoPrevisto: 'Consulta', montoAdelanto: '20.00' });
    const citaId = reserva.body.cita.id;

    const imp = await recep.get(`/api/caja/citas/${citaId}/importe`);
    expect(imp.body).toMatchObject({ tipo: 'adelanto', total: '20.00' });
    const adel = await recep.post(`/api/caja/citas/${citaId}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), montoRecibido: 50 });
    expect(adel.status).toBe(201);
    expect(adel.body).toMatchObject({ tipo: 'adelanto', total: '20.00', vuelto: '30.00', estadoCita: 'confirmada' });
    expect((await prisma.cita.findUniqueOrThrow({ where: { id: citaId } })).adelantoVenceEn).toBeNull();

    // llegó el día: se atiende con una extracción simple (S/ 80) → paga los S/ 60 restantes
    await prisma.cita.update({ where: { id: citaId }, data: { fecha: new Date(Date.now() - 86_400_000) } });
    const od = await sesion('odontologo');
    await od.post(`/api/citas/${citaId}/atencion`).send({ diagnostico: 'Resto radicular', tratamientos: [{ tratamientoId: await idTratamiento('Extracción simple') }] });
    const final = await recep.get(`/api/caja/citas/${citaId}/importe`);
    expect(final.body).toMatchObject({ tipo: 'servicio', subtotal: '80.00', adelantoAplicado: '20.00', sobrante: '0.00', total: '60.00' });
    const pago = await recep.post(`/api/caja/citas/${citaId}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    expect(pago.body).toMatchObject({ numero: 'C-000002', total: '60.00', adelantoAplicado: '20.00', estadoCita: 'pagada' });
  });

  it('el adelanto supera el cobro final: total S/ 0 y lo que sobra queda como saldo a favor', async () => {
    const c = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 125, venceEnMin: 30 });
    const recep = await sesion('recepcionista');
    await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    await prisma.cita.update({ where: { id: c.id }, data: { fecha: new Date(Date.now() - 86_400_000) } });
    const od = await sesion('odontologo');
    await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Control', tratamientos: [{ tratamientoId: await idTratamiento('Consulta') }] }); // S/ 40
    const r = await recep.get(`/api/caja/citas/${c.id}/importe`);
    expect(r.body).toMatchObject({ subtotal: '40.00', adelantoAplicado: '40.00', sobrante: '85.00', total: '0.00' });
    const pago = await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), montoRecibido: 0 });
    expect(pago.status).toBe(201);
    expect(pago.body).toMatchObject({ saldoGenerado: '85.00', paciente: { saldoFavor: '85.00' } });
  });

  it('el saldo a favor se usa solo en el siguiente cobro', async () => {
    await prisma.paciente.update({ where: { dni: '72458190' }, data: { saldoFavor: 50 } });
    const id = await citaAtendida(['Profilaxis']); // S/ 80
    const recep = await sesion('recepcionista');
    const r = await recep.get(`/api/caja/citas/${id}/importe`);
    expect(r.body).toMatchObject({ subtotal: '80.00', saldoAplicado: '50.00', total: '30.00' });
    const pago = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    expect(pago.body).toMatchObject({ total: '30.00', saldoAplicado: '50.00', paciente: { saldoFavor: '0.00' } });
    const mov = await prisma.saldoMovimiento.findMany({ where: { paciente: { dni: '72458190' } } });
    expect(mov.map((m) => [m.tipo, m.monto.toFixed(2), m.saldo.toFixed(2)])).toEqual([['uso_en_cobro', '-50.00', '0.00']]);
  });

  it('no se cobra el adelanto vencido ni el de una cita que ya pasó', async () => {
    const recep = await sesion('recepcionista');
    const vencido = await crearCita({ horas: 72, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: -1 });
    const r = await recep.get(`/api/caja/citas/${vencido.id}/importe`);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.ADELANTO_VENCIDO);
    const pasada = await crearCita({ horas: -2, estado: 'pendiente_adelanto', montoAdelanto: 20, venceEnMin: 30, odontologoEmail: 'carmen.diaz@clinica.local' });
    expect((await recep.get(`/api/caja/citas/${pasada.id}/importe`)).status).toBe(409);
  });
});

describe('CU-13 5: imprimir (PDF) y enviar por correo', () => {
  async function emitido(dni = '72458190') {
    const id = await citaAtendida(['Curación con resina'], dni);
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), montoRecibido: 200 });
    return { recep, comprobante: r.body };
  }

  it('genera el PDF del comprobante', async () => {
    const { recep, comprobante } = await emitido();
    const r = await recep.get(`/api/comprobantes/${comprobante.id}/pdf`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('C-000001.pdf');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((r.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('PDF de un comprobante inexistente → 404', async () => {
    const recep = await sesion('recepcionista');
    expect((await recep.get('/api/comprobantes/999/pdf')).status).toBe(404);
  });

  it('envía por correo y lo marca como enviado', async () => {
    const { recep, comprobante } = await emitido();
    const r = await recep.post(`/api/comprobantes/${comprobante.id}/enviar`);
    expect(r.status).toBe(200);
    expect(r.body.mensaje).toBe('Comprobante enviado a maria.quispe@correo.local');
    expect((await recep.get(`/api/comprobantes/${comprobante.id}`)).body.enviadoEmail).toBe(true);
  });

  it('9.1: paciente sin correo → 422', async () => {
    const { recep, comprobante } = await emitido('70112233'); // Lucía no tiene correo
    expect(comprobante.paciente.tieneCorreo).toBe(false);
    const r = await recep.post(`/api/comprobantes/${comprobante.id}/enviar`);
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.PACIENTE_SIN_CORREO);
  });

  it('RNF07: odontólogo y paciente no acceden a caja', async () => {
    for (const rol of ['odontologo', 'paciente'] as const) {
      const ag = await sesion(rol);
      expect((await ag.get('/api/caja/pendientes')).status).toBe(403);
      expect((await ag.get('/api/comprobantes/1/pdf')).status).toBe(403);
    }
  });
});
