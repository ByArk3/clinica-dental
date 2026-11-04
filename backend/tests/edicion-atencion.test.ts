// Editar una atención ya registrada (solo su odontólogo, con motivo; se guarda la versión anterior)
import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, idPaciente, idTipoPago, idTratamiento, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

const stock = async (nombre: string) => (await prisma.insumo.findUniqueOrThrow({ where: { nombre } })).stockActual.toNumber();

async function atencion(tratamientos: { t: string; pieza?: string }[]) {
  const c = await crearCita({ horas: -1, estado: 'confirmada' });
  const od = await sesion('odontologo');
  const r = await od.post(`/api/citas/${c.id}/atencion`).send({
    diagnostico: 'Caries en 16',
    observaciones: 'Control en 6 meses',
    tratamientos: await Promise.all(tratamientos.map(async (x) => ({ tratamientoId: await idTratamiento(x.t), piezaDental: x.pieza }))),
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { od, citaId: c.id, atencionId: r.body.atencionId as number };
}
const cuerpo = async (diagnostico: string, tratamientos: { t: string; pieza?: string }[], motivo = 'Corrijo la pieza dental', observaciones = 'Control en 6 meses') => ({
  diagnostico,
  observaciones,
  motivo,
  tratamientos: await Promise.all(tratamientos.map(async (x) => ({ tratamientoId: await idTratamiento(x.t), piezaDental: x.pieza }))),
});

describe('Editar una atención', () => {
  it('corrige el diagnóstico; el historial muestra «editado», quién, el motivo y lo que decía antes', async () => {
    const { od, atencionId } = await atencion([{ t: 'Curación con resina', pieza: '16' }]);
    const r = await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Caries profunda en 26', [{ t: 'Curación con resina', pieza: '16' }], 'Me equivoqué de pieza en el diagnóstico'));
    expect(r.status).toBe(200);
    expect(r.body.tratamientosCambiados).toBe(false);
    const h = (await od.get(`/api/pacientes/${await idPaciente('72458190')}/historial`)).body;
    expect(h.atenciones[0].diagnostico).toBe('Caries profunda en 26');
    expect(h.atenciones[0].ediciones).toEqual([
      expect.objectContaining({ por: 'Dr. Luis Paredes', motivo: 'Me equivoqué de pieza en el diagnóstico', anterior: { diagnostico: 'Caries en 16', observaciones: 'Control en 6 meses', tratamientos: [{ nombre: 'Curación con resina', piezaDental: '16' }] } }),
    ]);
    expect(await prisma.auditoria.count({ where: { accion: 'editar_atencion' } })).toBe(1);
  });

  it('antes del cobro cambia tratamientos: corrige el stock con la diferencia y mantiene el precio congelado', async () => {
    const { od, citaId, atencionId } = await atencion([{ t: 'Curación con resina', pieza: '16' }, { t: 'Profilaxis' }]);
    await prisma.tratamiento.update({ where: { nombre: 'Curación con resina' }, data: { precio: 999 } });
    const antes = { resina: await stock('Resina compuesta A2'), gasa: await stock('Gasa estéril'), pasta: await stock('Pasta profiláctica') };
    // quita la profilaxis, mantiene la resina (cambiando la pieza) y agrega una extracción simple
    const r = await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Caries en 26', [{ t: 'Curación con resina', pieza: '26' }, { t: 'Extracción simple', pieza: '38' }]));
    expect(r.status).toBe(200);
    expect(r.body.tratamientosCambiados).toBe(true);
    expect(await stock('Pasta profiláctica')).toBe(antes.pasta + 1); // vuelve al stock
    expect(await stock('Gasa estéril')).toBe(antes.gasa - 1); // nueva salida
    expect(await stock('Resina compuesta A2')).toBe(antes.resina); // sin cambio
    // la resina conserva su precio congelado (120), la extracción toma el del tarifario (80)
    const imp = (await (await sesion('recepcionista')).get(`/api/caja/citas/${citaId}/importe`)).body;
    expect(imp.lineas.map((l: { descripcion: string; precio: string }) => [l.descripcion, l.precio])).toEqual([
      ['Curación con resina — pieza 26', '120.00'],
      ['Extracción simple — pieza 38', '80.00'],
    ]);
  });

  it('ya cobrada: solo diagnóstico y observaciones; para cambiar tratamientos hay que anular el comprobante', async () => {
    const { od, citaId, atencionId } = await atencion([{ t: 'Profilaxis' }]);
    const recep = await sesion('recepcionista');
    const comp = (await recep.post(`/api/caja/citas/${citaId}/comprobante`).send({ tipoPagoId: await idTipoPago('Tarjeta') })).body;
    expect((await od.get(`/api/atenciones/${atencionId}`)).body.cobrada).toBe(true);
    const r = await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Caries en 16', [{ t: 'Destartraje' }]));
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.ATENCION_COBRADA);
    expect((await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Gingivitis leve', [{ t: 'Profilaxis' }]))).status).toBe(200);
    // anulado el comprobante, ya se puede cambiar
    await recep.patch(`/api/comprobantes/${comp.id}/anular`).send({ motivo: 'Faltó el destartraje' });
    expect((await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Gingivitis leve', [{ t: 'Destartraje' }]))).status).toBe(200);
    expect((await recep.get(`/api/caja/citas/${citaId}/importe`)).body.total).toBe('120.00');
  });

  it('solo el odontólogo que la registró; motivo obligatorio; sin cambios no guarda', async () => {
    const { od, atencionId } = await atencion([{ t: 'Consulta' }]);
    const otra = await (await import('supertest')).default.agent((await import('./helpers.js')).app);
    await otra.post('/api/auth/login').send({ email: 'carmen.diaz@clinica.local', password: (await import('./helpers.js')).PASSWORD });
    const ajena = await otra.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Otra cosa', [{ t: 'Consulta' }]));
    expect(ajena.status).toBe(403);
    expect(ajena.body.mensaje).toBe(MENSAJES.ATENCION_NO_EDITABLE);
    expect((await otra.get(`/api/atenciones/${atencionId}`)).status).toBe(403);
    expect((await (await sesion('administrador')).patch(`/api/atenciones/${atencionId}`).send(await cuerpo('X', [{ t: 'Consulta' }]))).status).toBe(403);

    expect((await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Caries en 17', [{ t: 'Consulta' }], ''))).status).toBe(422);
    const igual = await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Caries en 16', [{ t: 'Consulta' }]));
    expect(igual.status).toBe(422);
    expect(igual.body.mensaje).toBe(MENSAJES.ATENCION_SIN_CAMBIOS);
    expect(await prisma.atencionEdicion.count()).toBe(0);
  });

  it('RN-08: no acepta tratamientos nuevos desactivados', async () => {
    const { od, atencionId } = await atencion([{ t: 'Consulta' }]);
    await prisma.tratamiento.update({ where: { nombre: 'Blanqueamiento' }, data: { activo: false } });
    const r = await od.patch(`/api/atenciones/${atencionId}`).send(await cuerpo('Caries en 16', [{ t: 'Consulta' }, { t: 'Blanqueamiento' }]));
    expect(r.body.mensaje).toBe(MENSAJES.TRATAMIENTO_NO_TARIFARIO);
  });

  it('«Mis citas del día» trae el id de la atención para editarla', async () => {
    const { od, atencionId } = await atencion([{ t: 'Consulta' }]);
    const hoy = (await import('../src/lib/fechas.js')).dateAFecha((await prisma.cita.findFirstOrThrow()).fecha);
    const r = await od.get(`/api/odontologos/me/citas?fecha=${hoy}`);
    expect(r.body[0]).toMatchObject({ estado: 'atendida', atencionId });
  });
});
