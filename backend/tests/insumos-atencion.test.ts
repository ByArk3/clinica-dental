// Pendiente 32: el odontólogo ajusta los insumos de la atención (cantidades, quitar, agregar, motivo)
import { beforeEach, describe, expect, it } from 'vitest';
import { crearCita, idTratamiento, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

const insumo = (nombre: string) => prisma.insumo.findUniqueOrThrow({ where: { nombre } });
const stock = async (nombre: string) => (await insumo(nombre)).stockActual.toNumber();

describe('Insumos ajustados por el odontólogo', () => {
  it('lista de insumos activos para el odontólogo (sin acceso al resto del inventario)', async () => {
    const od = await sesion('odontologo');
    const r = await od.get('/api/insumos/para-atencion');
    expect(r.status).toBe(200);
    expect(r.body[0]).toEqual(expect.objectContaining({ id: expect.any(Number), nombre: expect.any(String), unidad: expect.any(String) }));
    expect((await od.get('/api/insumos')).status).toBe(403);
  });

  it('registrar: descuenta lo indicado (2 resinas, sin guantes, con gasa) y anota el motivo en el kárdex', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const antes = { resina: await stock('Resina compuesta A2'), guantes: await stock('Guantes de nitrilo M'), gasa: await stock('Gasa estéril'), anestesia: await stock('Anestesia lidocaína 2 %') };
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({
      diagnostico: 'Caries amplia en 26',
      tratamientos: [{ tratamientoId: await idTratamiento('Curación con resina'), piezaDental: '26' }],
      insumos: [
        { insumoId: (await insumo('Resina compuesta A2')).id, cantidad: 2 },
        { insumoId: (await insumo('Anestesia lidocaína 2 %')).id, cantidad: 1 },
        { insumoId: (await insumo('Gasa estéril')).id, cantidad: 1 },
      ],
      motivoInsumos: 'Lesión grande: se usó más resina',
    });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe('120.00'); // el precio no cambia
    expect(await stock('Resina compuesta A2')).toBe(antes.resina - 2);
    expect(await stock('Guantes de nitrilo M')).toBe(antes.guantes);
    expect(await stock('Gasa estéril')).toBe(antes.gasa - 1);
    expect(await stock('Anestesia lidocaína 2 %')).toBe(antes.anestesia - 1);
    const mov = await prisma.movimientoKardex.findFirstOrThrow({ where: { referenciaTipo: 'atencion', referenciaId: r.body.atencionId } });
    expect(mov.motivo).toMatch(/insumos ajustados por el odontólogo: Lesión grande/);
  });

  it('no acepta un insumo desactivado', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const gasa = await insumo('Gasa estéril');
    await prisma.insumo.update({ where: { id: gasa.id }, data: { activo: false } });
    const r = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Control general', tratamientos: [{ tratamientoId: await idTratamiento('Consulta') }], insumos: [{ insumoId: gasa.id, cantidad: 1 }] });
    expect(r.status).toBe(422);
  });

  it('editar: compara con lo que realmente se descontó y corrige solo la diferencia', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const resina = await insumo('Resina compuesta A2');
    const curacion = await idTratamiento('Curación con resina');
    const inicial = await stock('Resina compuesta A2');
    const at = (await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Caries en 16', tratamientos: [{ tratamientoId: curacion, piezaDental: '16' }], insumos: [{ insumoId: resina.id, cantidad: 3 }] })).body;
    expect(await stock('Resina compuesta A2')).toBe(inicial - 3);
    // la edición muestra los insumos realmente usados
    expect((await od.get(`/api/atenciones/${at.atencionId}`)).body.insumos).toEqual([{ insumoId: resina.id, cantidad: '3.00' }]);
    // corrige: eran 2 resinas → devuelve 1 al stock
    const r = await od.patch(`/api/atenciones/${at.atencionId}`).send({ diagnostico: 'Caries en 16', motivo: 'Se contó mal la resina', tratamientos: [{ tratamientoId: curacion, piezaDental: '16' }], insumos: [{ insumoId: resina.id, cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(await stock('Resina compuesta A2')).toBe(inicial - 2);
    // sin insumos y sin cambiar tratamientos: no vuelve a tocar el stock
    await od.patch(`/api/atenciones/${at.atencionId}`).send({ diagnostico: 'Caries profunda en 16', motivo: 'Detallo el diagnóstico', tratamientos: [{ tratamientoId: curacion, piezaDental: '16' }] });
    expect(await stock('Resina compuesta A2')).toBe(inicial - 2);
  });
});
