import { beforeEach, describe, expect, it } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { crearCita, idOdontologo, idPaciente, prisma, proximo, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

const LUNES = () => proximo(1);
const MARTES = () => proximo(2);

async function citaWeb(hora = '10:00') {
  const pac = await sesion('paciente');
  const r = await pac.post('/api/citas').send({ odontologoId: await idOdontologo(), fecha: LUNES(), hora, motivo: 'Control' });
  return { pac, cita: r.body.cita };
}

describe('CU-07 Reprogramar cita', () => {
  it('flujo básico (paciente): cambia fecha y hora, libera el horario anterior y renueva el enlace', async () => {
    const { pac, cita } = await citaWeb('10:00');
    const tokenAntes = (await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } })).tokenConfirmacion;
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: cita.odontologoId, fecha: MARTES(), hora: '11:30' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: cita.id, fecha: MARTES(), hora: '11:30', estado: 'pendiente_confirmacion' });
    const enBD = await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } });
    expect(enBD.tokenConfirmacion).not.toBe(tokenAntes);
    expect(enBD.recordatorioEnviadoEn).toBeNull();
    const disp = await pac.get(`/api/disponibilidad?odontologoId=${cita.odontologoId}&fecha=${LUNES()}`);
    expect(disp.body.horarios).toContain('10:00');
  });

  it('una cita confirmada que se reprograma vuelve a «Pendiente de confirmación»', async () => {
    const { pac, cita } = await citaWeb();
    await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'confirmada' } });
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: cita.odontologoId, fecha: LUNES(), hora: '15:00' });
    expect(r.body.estado).toBe('pendiente_confirmacion');
  });

  it('se puede reprogramar a otra hora del mismo día con el mismo odontólogo', async () => {
    const { pac, cita } = await citaWeb('10:00');
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: cita.odontologoId, fecha: LUNES(), hora: '10:30' });
    expect(r.status).toBe(200);
  });

  it('RN-12: si debía el adelanto, lo sigue debiendo', async () => {
    await prisma.paciente.update({ where: { dni: '72458190' }, data: { inasistencias: 3, restringido: true } });
    const { pac, cita } = await citaWeb();
    expect(cita.estado).toBe('pendiente_adelanto');
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: cita.odontologoId, fecha: MARTES(), hora: '09:00' });
    expect(r.body.estado).toBe('pendiente_adelanto');
  });

  it('alterno: el nuevo horario está tomado → 409 «El horario ya no está disponible»', async () => {
    const { pac, cita } = await citaWeb('10:00');
    const recep = await sesion('recepcionista');
    await recep.post('/api/citas').send({ pacienteId: await idPaciente('70112233'), odontologoId: cita.odontologoId, fecha: LUNES(), hora: '11:00', motivo: 'Control' });
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: cita.odontologoId, fecha: LUNES(), hora: '11:00' });
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toBe(MENSAJES.HORARIO_NO_DISPONIBLE);
  });

  it('alterno: nuevo horario fuera de atención → 422 (RN-03)', async () => {
    const { pac, cita } = await citaWeb();
    const r = await pac.patch(`/api/citas/${cita.id}/reprogramar`).send({ odontologoId: cita.odontologoId, fecha: proximo(7), hora: '10:00' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.CLINICA_NO_ATIENDE);
  });

  it('P8: el paciente no puede reprogramar a menos de 24 h; la recepcionista sí', async () => {
    const c = await crearCita({ horas: 20, estado: 'confirmada' });
    const pac = await sesion('paciente');
    const datos = { odontologoId: c.odontologoId, fecha: LUNES(), hora: '13:00' };
    const r = await pac.patch(`/api/citas/${c.id}/reprogramar`).send(datos);
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.LIMITE_24H);
    const recep = await sesion('recepcionista');
    expect((await recep.patch(`/api/citas/${c.id}/reprogramar`).send(datos)).status).toBe(200);
  });

  it('el paciente no puede tocar citas de otro paciente (404)', async () => {
    const c = await crearCita({ horas: 100, dni: '70112233' });
    const pac = await sesion('paciente');
    const r = await pac.patch(`/api/citas/${c.id}/cancelar`);
    expect(r.status).toBe(404);
    expect(r.body.mensaje).toBe(MENSAJES.CITA_NO_ENCONTRADA);
  });
});

describe('CU-07 Cancelar cita', () => {
  it('flujo básico (paciente): queda «Cancelada» y el horario se libera', async () => {
    const { pac, cita } = await citaWeb('10:00');
    const r = await pac.patch(`/api/citas/${cita.id}/cancelar`);
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('cancelada');
    const disp = await pac.get(`/api/disponibilidad?odontologoId=${cita.odontologoId}&fecha=${LUNES()}`);
    expect(disp.body.horarios).toContain('10:00');
  });

  it('flujo básico (recepcionista): cancela aunque falten menos de 24 h', async () => {
    const c = await crearCita({ horas: 5, estado: 'confirmada' });
    const recep = await sesion('recepcionista');
    expect((await recep.patch(`/api/citas/${c.id}/cancelar`)).body.estado).toBe('cancelada');
  });

  it('alterno: cita ya atendida, cancelada o pasada → 409', async () => {
    const recep = await sesion('recepcionista');
    const atendida = await crearCita({ horas: 50, estado: 'atendida' });
    const pasada = await crearCita({ horas: -3, estado: 'confirmada', odontologoEmail: 'carmen.diaz@clinica.local' });
    for (const c of [atendida, pasada]) {
      const r = await recep.patch(`/api/citas/${c.id}/cancelar`);
      expect(r.status).toBe(409);
      expect(r.body.mensaje).toBe(MENSAJES.CITA_NO_MODIFICABLE);
    }
  });

  it('RNF07: el odontólogo no cancela citas', async () => {
    const c = await crearCita({ horas: 50 });
    expect((await (await sesion('odontologo')).patch(`/api/citas/${c.id}/cancelar`)).status).toBe(403);
  });
});

describe('Reservas de último momento (< 24 h)', () => {
  it('quedan «Pendiente de adelanto»: 50 % de la consulta y 1 hora para pagar', async () => {
    const recep = await sesion('recepcionista');
    const odontologoId = await idOdontologo();
    const { ahoraLima, sumarDias } = await import('../src/lib/fechas.js');
    const hoy = ahoraLima().fecha;
    let elegido: { fecha: string; hora: string } | null = null;
    for (const f of [hoy, sumarDias(hoy, 1)]) {
      const d = await recep.get(`/api/disponibilidad?odontologoId=${odontologoId}&fecha=${f}`);
      for (const h of d.body.horarios as string[]) {
        const horas = (new Date(`${f}T${h}:00-05:00`).getTime() - Date.now()) / 3_600_000;
        if (horas < 23) { elegido = { fecha: f, hora: h }; break; }
      }
      if (elegido) break;
    }
    if (!elegido) return; // (p. ej. sábado de noche: no hay atención en las próximas 24 h)
    const antes = Date.now();
    const r = await recep.post('/api/citas').send({ ...elegido, odontologoId, pacienteId: await idPaciente('70112233'), motivo: 'Urgencia' });
    expect(r.status).toBe(201);
    expect(r.body.cita).toMatchObject({ estado: 'pendiente_adelanto', tratamientoPrevisto: 'Consulta', montoAdelanto: '20.00' });
    const vence = new Date(r.body.cita.adelantoVenceEn).getTime();
    expect(vence - antes).toBeGreaterThanOrEqual(59 * 60_000);
    expect(vence - antes).toBeLessThanOrEqual(61 * 60_000);
    expect(r.body.pago).toEqual({ numero: '987654321', titular: 'Clínica Dental (ficticio)', billeteras: ['yape'], tieneQr: false });
  });
});
