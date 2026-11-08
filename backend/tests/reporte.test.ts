import { beforeEach, describe, expect, it } from 'vitest';
import { crearCita, prisma, reiniciarBD, sesion } from './helpers.js';
import { ahoraLima } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

const idTrat = async (n: string) => (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: n } })).id;
const tipoPago = async (n: string) => (await prisma.tipoPago.findUniqueOrThrow({ where: { nombre: n } })).id;

/** Atiende y cobra una cita: devuelve el total cobrado. */
async function cobrada(tratamientos: string[], pago: string, horas: number, dni = '72458190') {
  const c = await crearCita({ horas: -horas, estado: 'confirmada', dni });
  const od = await sesion('odontologo');
  await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Prueba', tratamientos: await Promise.all(tratamientos.map(async (t) => ({ tratamientoId: await idTrat(t) }))) });
  const recep = await sesion('recepcionista');
  const total = Number((await recep.get(`/api/caja/citas/${c.id}/importe`)).body.total);
  const r = await recep.post(`/api/caja/citas/${c.id}/comprobante`).send({ tipoPagoId: await tipoPago(pago), montoRecibido: total });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
}

describe('CU-38 Panel de control', () => {
  it('resume citas de hoy, ingresos, alertas y pedidos pendientes', async () => {
    await cobrada(['Curación con resina'], 'Efectivo', 1); // genera alertas de resina y guantes
    await crearCita({ horas: 3, estado: 'confirmada', dni: '70112233', odontologoEmail: 'carmen.diaz@clinica.local' });
    const admin = await sesion('administrador');
    const r = await admin.get('/api/panel');
    expect(r.status).toBe(200);
    expect(r.body.fecha).toBe(ahoraLima().fecha);
    expect(r.body.ingresos).toMatchObject({ hoy: '120.00', comprobantesHoy: 1, mes: '120.00' });
    expect(r.body.ingresos.ultimos7Dias).toHaveLength(7);
    expect(r.body.ingresos.ultimos7Dias.at(-1)).toEqual({ fecha: ahoraLima().fecha, total: '120.00' });
    expect(r.body.inventario.alertas.map((a: { insumo: string }) => a.insumo).sort()).toEqual(['Guantes de nitrilo M', 'Resina compuesta A2']);
    expect(r.body.inventario.pedidosPendientes).toBe(0);
  });

  it('RNF07: solo el Administrador', async () => {
    expect((await (await sesion('recepcionista')).get('/api/panel')).status).toBe(403);
  });
});

describe('CU-39 Reporte de ingresos', () => {
  it('totaliza por tipo de pago y por tratamiento en el rango, con detalle de comprobantes', async () => {
    await cobrada(['Curación con resina', 'Profilaxis'], 'Efectivo', 1);
    await cobrada(['Profilaxis'], 'Yape', 2, '70112233');
    const admin = await sesion('administrador');
    const hoy = ahoraLima().fecha;
    const r = await admin.get(`/api/reportes/ingresos?desde=${hoy}&hasta=${hoy}`);
    expect(r.body.resumen).toMatchObject({ total: '280.00', comprobantes: 2, ticketPromedio: '140.00' });
    expect(r.body.porTipoPago).toEqual([
      { tipo: 'Efectivo', total: '200.00', cantidad: 1 },
      { tipo: 'Yape', total: '80.00', cantidad: 1 },
    ]);
    expect(r.body.porTratamiento).toEqual([
      { tratamiento: 'Profilaxis', cantidad: 2, importe: '160.00' },
      { tratamiento: 'Curación con resina', cantidad: 1, importe: '120.00' },
    ]);
    expect(r.body.detalle.map((d: { numero: string }) => d.numero)).toEqual(['C-000001', 'C-000002']);
    // fuera de rango
    expect((await admin.get('/api/reportes/ingresos?desde=2020-01-01&hasta=2020-01-31')).body.resumen.total).toBe('0.00');
  });

  it('exporta CSV (separador «;», con BOM para Excel)', async () => {
    await cobrada(['Consulta'], 'Tarjeta', 1);
    const admin = await sesion('administrador');
    const r = await admin.get('/api/reportes/ingresos?formato=csv');
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="ingresos_/);
    const lineas = r.text.replace(/^﻿/, '').split('\r\n');
    expect(lineas[0]).toBe('Número;Fecha;Tipo;Paciente;DNI;Tipo de pago;Subtotal;Descuento;Adelanto aplicado;Total;Estado;Motivo de anulación');
    expect(lineas[1]).toMatch(/^C-000001;.*;servicio;Quispe Rojas, María;72458190;Tarjeta;40\.00;0\.00;0\.00;40\.00;Vigente;$/);
  });

  it('rango inválido → 422', async () => {
    const admin = await sesion('administrador');
    expect((await admin.get('/api/reportes/ingresos?desde=2026-02-01&hasta=2026-01-01')).status).toBe(422);
  });
});

describe('CU-40 Reporte de inventario', () => {
  it('stock vs mínimo, entradas, consumo y mermas del rango', async () => {
    await cobrada(['Curación con resina'], 'Efectivo', 1);
    const admin = await sesion('administrador');
    const copa = (await prisma.insumo.findUniqueOrThrow({ where: { nombre: 'Copa de goma' } })).id;
    await admin.post(`/api/insumos/${copa}/ajuste`).send({ tipo: 'merma', cantidad: 2, motivo: 'Dañadas' });
    const hoy = ahoraLima().fecha;
    const r = await admin.get(`/api/reportes/inventario?desde=${hoy}&hasta=${hoy}`);
    const fila = (n: string) => r.body.insumos.find((i: { nombre: string }) => i.nombre === n);
    expect(fila('Resina compuesta A2')).toMatchObject({ stockActual: '4.00', entradas: '5.00', consumo: '1.00', bajoMinimo: true });
    expect(fila('Copa de goma')).toMatchObject({ mermas: '2.00', stockActual: '10.00' });
    expect(r.body.resumen.bajoMinimo).toBe(2);
    const csv = await admin.get(`/api/reportes/inventario?desde=${hoy}&hasta=${hoy}&formato=csv`);
    expect(csv.text).toContain('Resina compuesta A2;jeringa;Sí;4.00;5.00;Sí;5.00;1.00;0.00;0.00');
  });
});
