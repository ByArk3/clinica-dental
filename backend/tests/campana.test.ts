// Campañas de descuento aplicadas en caja (por línea, según la fecha de la cita)
import { beforeEach, describe, expect, it } from 'vitest';
import { crearCampana, crearCita, idTratamiento, prisma, reiniciarBD, sesion } from './helpers.js';
import { ahoraLima, dateAFecha, sumarDias } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

let horasAtras = 1;
beforeEach(() => {
  horasAtras = 1;
});
/** Cita atendida (ayer u hoy) con los tratamientos dados; devuelve su id y fecha. */
async function atendida(tratamientos: string[], dni = '72458190') {
  const c = await crearCita({ horas: -horasAtras, estado: 'confirmada', dni });
  horasAtras += 1;
  const od = await sesion('odontologo');
  const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Prueba', tratamientos: await Promise.all(tratamientos.map(async (t) => ({ tratamientoId: await idTratamiento(t) }))) });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { id: c.id, fecha: dateAFecha(c.fecha) };
}
const importe = async (id: number) => (await (await sesion('recepcionista')).get(`/api/caja/citas/${id}/importe`)).body;

describe('Campañas de descuento en caja', () => {
  it('aplica solo a los tratamientos de la campaña', async () => {
    const c = await atendida(['Profilaxis', 'Consulta']);
    await crearCampana({ nombre: 'Limpieza 20 %', tratamientos: ['Profilaxis'], desde: sumarDias(c.fecha, -1), hasta: sumarDias(c.fecha, 1), porcentaje: 20 });
    const r = await importe(c.id);
    expect(r).toMatchObject({ subtotal: '120.00', descuento: '16.00', total: '104.00' });
    expect(r.lineas.map((l: { campana: string | null; descuento: string }) => [l.campana, l.descuento])).toEqual([['Limpieza 20 %', '16.00'], [null, '0.00']]);
  });

  it('cuenta la fecha de la CITA: si la campaña terminó antes, no aplica aunque se cobre durante otra', async () => {
    const c = await atendida(['Profilaxis']);
    await crearCampana({ nombre: 'Terminó antes', tratamientos: ['Profilaxis'], desde: sumarDias(c.fecha, -10), hasta: sumarDias(c.fecha, -1), porcentaje: 50 });
    expect((await importe(c.id)).descuento).toBe('0.00');
  });

  it('dos campañas sobre la misma línea: gana la mayor, no se suman', async () => {
    const c = await atendida(['Blanqueamiento']); // S/ 450
    await crearCampana({ nombre: 'Navidad 20 %', tratamientos: ['Blanqueamiento'], desde: c.fecha, hasta: c.fecha, porcentaje: 20 });
    await crearCampana({ nombre: 'Fiestas 25 %', tratamientos: ['Blanqueamiento'], desde: c.fecha, hasta: c.fecha, porcentaje: 25 });
    const r = await importe(c.id);
    expect(r).toMatchObject({ descuento: '112.50', total: '337.50' });
    expect(r.lineas[0].campana).toBe('Fiestas 25 %');
  });

  it('edad máxima: la campaña escolar (≤ 17 años) aplica a un menor y no a un adulto', async () => {
    const menor = await prisma.paciente.create({
      data: { dni: '80808080', nombres: 'Sofía', apellidos: 'Ruiz', fechaNacimiento: new Date('2015-05-05T00:00:00Z'), telefono: '955111222', apoderado: 'Elena Ruiz', ficha: { create: {} } },
    });
    const hoy = ahoraLima().fecha;
    await crearCampana({ nombre: 'Escolar 30 %', tratamientos: ['Aplicación de flúor'], desde: sumarDias(hoy, -5), hasta: sumarDias(hoy, 5), porcentaje: 30, edadMaxima: 17 });
    const nino = await atendida(['Aplicación de flúor'], menor.dni);
    const adulto = await atendida(['Aplicación de flúor'], '74556677'); // Diego, 2001
    expect((await importe(nino.id)).descuento).toBe('12.00');
    expect((await importe(adulto.id)).descuento).toBe('0.00');
  });

  it('3x2 en resinas: de 3 curaciones, 1 gratis; de 4, también 1', async () => {
    const tres = await atendida(['Curación con resina', 'Curación con resina', 'Curación con resina']);
    const cuatro = await atendida(['Curación con resina', 'Curación con resina', 'Curación con resina', 'Curación con resina'], '70112233');
    await crearCampana({ nombre: 'Resinas 3x2', tipo: 'tres_por_dos', tratamientos: ['Curación con resina'], desde: sumarDias(tres.fecha, -1), hasta: sumarDias(tres.fecha, 1) });
    expect(await importe(tres.id)).toMatchObject({ subtotal: '360.00', descuento: '120.00', total: '240.00' });
    expect(await importe(cuatro.id)).toMatchObject({ subtotal: '480.00', descuento: '120.00', total: '360.00' });
  });

  it('una campaña desactivada no aplica', async () => {
    const c = await atendida(['Profilaxis']);
    const camp = await crearCampana({ nombre: 'Apagada', tratamientos: ['Profilaxis'], desde: c.fecha, hasta: c.fecha, porcentaje: 20 });
    await prisma.descuento.update({ where: { id: camp.id }, data: { activo: false } });
    expect((await importe(c.id)).descuento).toBe('0.00');
  });
});
