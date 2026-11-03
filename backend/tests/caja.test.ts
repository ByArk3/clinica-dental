import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, idOdontologo, prisma, proximo, reiniciarBD, sesion } from './helpers.js';

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
  it('1: lista citas «Atendida» por cobrar y «Pendiente de adelanto» futuras', async () => {
    const atendida = await citaAtendida(['Profilaxis']);
    const adelanto = await crearCita({ horas: 72, estado: 'pendiente_adelanto', dni: '73445566', odontologoEmail: 'carmen.diaz@clinica.local' });
    await crearCita({ horas: -5, estado: 'pendiente_adelanto', dni: '74556677', odontologoEmail: 'carmen.diaz@clinica.local' }); // ya pasó
    const recep = await sesion('recepcionista');
    const r = await recep.get('/api/caja/pendientes');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ citaId: atendida, tipo: 'servicio', importe: '80.00' }),
        expect.objectContaining({ citaId: adelanto.id, tipo: 'adelanto', importe: '30.00' }),
      ]),
    );
    expect(r.body).toHaveLength(2);
  });

  it('2 / RN-10: importe = Σ precios congelados en la atención (aunque luego cambie el tarifario)', async () => {
    const id = await citaAtendida(['Curación con resina', 'Profilaxis']);
    await prisma.tratamiento.update({ where: { nombre: 'Profilaxis' }, data: { precio: 999 } });
    const recep = await sesion('recepcionista');
    const r = await recep.get(`/api/caja/citas/${id}/importe`);
    expect(r.body).toMatchObject({ tipo: 'servicio', subtotal: '200.00', descuento: '0.00', adelantoAplicado: '0.00', total: '200.00' });
    expect(r.body.lineas.map((l: { descripcion: string; precio: string }) => [l.descripcion, l.precio])).toEqual([
      ['Curación con resina', '120.00'],
      ['Profilaxis', '80.00'],
    ]);
  });

  it('P3: un descuento activo se aplica sobre el subtotal (redondeo a 2 decimales); inactivo → 422', async () => {
    const id = await citaAtendida(['Curación con resina', 'Profilaxis', 'Consulta']); // 240
    const recep = await sesion('recepcionista');
    const d = await prisma.descuento.findUniqueOrThrow({ where: { nombre: 'Paciente frecuente' } }); // 10 %
    const r = await recep.get(`/api/caja/citas/${id}/importe?descuentoId=${d.id}`);
    expect(r.body).toMatchObject({ subtotal: '240.00', descuento: '24.00', total: '216.00', descuentoAplicado: { nombre: 'Paciente frecuente' } });
    await prisma.descuento.update({ where: { id: d.id }, data: { activo: false } });
    const mal = await recep.get(`/api/caja/citas/${id}/importe?descuentoId=${d.id}`);
    expect(mal.status).toBe(422);
    expect(mal.body.mensaje).toBe(MENSAJES.DESCUENTO_NO_VALIDO);
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
      lineas: [{ descripcion: 'Curación con resina', precio: '120.00' }],
    });
    // RN-11: vinculado a la cita, con fecha, paciente, importe y tipo de pago
    const c = await prisma.comprobante.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(c.citaId).toBe(id);
    // y desaparece de pendientes
    expect((await recep.get('/api/caja/pendientes')).body).toEqual([]);
  });

  it('tarjeta o Yape/Plin: se cobra el total exacto, sin vuelto', async () => {
    const id = await citaAtendida(['Profilaxis']);
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Yape/Plin'), montoRecibido: 500 });
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

  it('con descuento: el comprobante guarda el descuento aplicado', async () => {
    const id = await citaAtendida(['Curación con resina']);
    const recep = await sesion('recepcionista');
    const d = await prisma.descuento.findFirstOrThrow();
    const r = await recep.post(`/api/caja/citas/${id}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta'), descuentoId: d.id });
    expect(r.body).toMatchObject({ subtotal: '120.00', total: '108.00', descuento: { nombre: 'Paciente frecuente', monto: '12.00' } });
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

describe('CU-13 3.1 / RN-12 Adelanto', () => {
  it('cobra el adelanto (S/ 30), la cita vuelve a «Pendiente de confirmación» y se descuenta en el cobro final', async () => {
    await prisma.paciente.update({ where: { dni: '73445566' }, data: { inasistencias: 3, restringido: true } });
    const recep = await sesion('recepcionista');
    const pedro = (await prisma.paciente.findUniqueOrThrow({ where: { dni: '73445566' } })).id;
    const reserva = await recep.post('/api/citas').send({ pacienteId: pedro, odontologoId: await idOdontologo(), fecha: proximo(1), hora: '10:00', motivo: 'Control' });
    expect(reserva.body.cita.estado).toBe('pendiente_adelanto');
    const citaId = reserva.body.cita.id;

    const imp = await recep.get(`/api/caja/citas/${citaId}/importe`);
    expect(imp.body).toMatchObject({ tipo: 'adelanto', total: '30.00', descuentoAplicado: null });
    const adel = await recep.post(`/api/caja/citas/${citaId}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), montoRecibido: 50, descuentoId: (await prisma.descuento.findFirstOrThrow()).id });
    expect(adel.status).toBe(201);
    expect(adel.body).toMatchObject({ tipo: 'adelanto', total: '30.00', vuelto: '20.00', descuento: null, estadoCita: 'pendiente_confirmacion' });

    // simular que llegó el día: confirmada, pasó la hora, se atiende
    await prisma.cita.update({ where: { id: citaId }, data: { estado: 'confirmada', fecha: new Date(Date.now() - 86_400_000) } });
    const od = await sesion('odontologo');
    await od.post(`/api/citas/${citaId}/atencion`).send({ diagnostico: 'Control', tratamientos: [{ tratamientoId: await idTrat('Profilaxis') }] });

    const final = await recep.get(`/api/caja/citas/${citaId}/importe`);
    expect(final.body).toMatchObject({ tipo: 'servicio', subtotal: '80.00', adelantoAplicado: '30.00', total: '50.00' });
    const pago = await recep.post(`/api/caja/citas/${citaId}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    expect(pago.body).toMatchObject({ numero: 'C-000002', total: '50.00', adelantoAplicado: '30.00', estadoCita: 'pagada' });
  });

  it('el adelanto nunca deja el total final en negativo', async () => {
    await prisma.configuracion.update({ where: { clave: 'monto_adelanto' }, data: { valor: '60.00' } });
    const c = await crearCita({ horas: 72, estado: 'pendiente_adelanto' });
    const recep = await sesion('recepcionista');
    await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    await prisma.cita.update({ where: { id: c.id }, data: { estado: 'confirmada', fecha: new Date(Date.now() - 86_400_000) } });
    const od = await sesion('odontologo');
    await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Control', tratamientos: [{ tratamientoId: await idTrat('Consulta') }] }); // S/ 40
    const r = await recep.get(`/api/caja/citas/${c.id}/importe`);
    expect(r.body).toMatchObject({ subtotal: '40.00', adelantoAplicado: '40.00', total: '0.00' });
    const pago = await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await tipoPago('Efectivo'), montoRecibido: 0 });
    expect(pago.status).toBe(201);
    // TODO(decisión P6): ¿qué pasa con los S/ 20 restantes del adelanto? Hoy no se devuelven ni se acumulan.
  });

  it('adelanto pagado con menos de 24 h para la cita → queda «Confirmada» (RN-04)', async () => {
    const c = await crearCita({ horas: 10, estado: 'pendiente_adelanto' });
    const recep = await sesion('recepcionista');
    const r = await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await tipoPago('Tarjeta') });
    expect(r.body.estadoCita).toBe('confirmada');
  });

  it('no se cobra adelanto de una cita que ya pasó', async () => {
    const c = await crearCita({ horas: -2, estado: 'pendiente_adelanto' });
    const recep = await sesion('recepcionista');
    expect((await recep.get(`/api/caja/citas/${c.id}/importe`)).status).toBe(409);
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
