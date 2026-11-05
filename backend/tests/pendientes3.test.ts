// Horario de cada odontólogo, alertas de stock (reabrir y al subir el mínimo), RUC (SUNAT),
// campos numéricos y vigencia del saldo a favor
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MENSAJES } from '@clinica/shared';
import { idOdontologo, idPaciente, prisma, proximo, reiniciarBD, sesion } from './helpers.js';
import { moverSaldo } from '../src/services/saldo.service.js';
import { revisarSaldos } from '../src/jobs/citas.jobs.js';

beforeEach(reiniciarBD);
afterEach(() => {
  delete process.env.RENIEC_TOKEN;
  vi.restoreAllMocks();
});

const insumo = (nombre: string) => prisma.insumo.findUniqueOrThrow({ where: { nombre } });

describe('Horario de cada odontólogo en la lista', () => {
  it('sin horario propio muestra el general; con horario propio, el suyo (corto para la lista y largo para la ayuda)', async () => {
    const admin = await sesion('administrador');
    await admin.put(`/api/admin/odontologos/${await idOdontologo()}/horario`).send({ tramos: [1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, horaInicio: '08:00', horaFin: '14:00' })) });
    const lista = (await (await sesion('paciente')).get('/api/odontologos')).body;
    const paredes = lista.find((o: { nombres: string }) => o.nombres === 'Dr. Luis Paredes');
    const diaz = lista.find((o: { nombres: string }) => o.nombres === 'Dra. Carmen Díaz');
    expect(paredes.horario).toEqual({ corto: 'Lunes–Viernes 08:00–14:00', largo: 'lunes a viernes, de 08:00 a 14:00' });
    expect(diaz.horario).toEqual({ corto: 'Lunes–Sábado 08:00–20:00', largo: 'lunes a sábado, de 08:00 a 20:00' }); // general de la clínica
  });
});

describe('Alertas de stock', () => {
  it('RN-14: al subir el mínimo por encima del stock actual se genera la alerta (sin duplicarla)', async () => {
    const admin = await sesion('administrador');
    const copa = await insumo('Copa de goma'); // stock 12, mínimo 5
    await admin.patch(`/api/insumos/${copa.id}`).send({ nombre: copa.nombre, unidad: copa.unidad, stockMinimo: 15 });
    expect(await prisma.alertaStock.count({ where: { insumoId: copa.id, revisada: false } })).toBe(1);
    await admin.patch(`/api/insumos/${copa.id}`).send({ nombre: copa.nombre, unidad: copa.unidad, stockMinimo: 20 });
    expect(await prisma.alertaStock.count({ where: { insumoId: copa.id } })).toBe(1);
  });

  it('un insumo que empieza bajo el mínimo (semilla) nace con su alerta', async () => {
    const guantes = await insumo('Guantes de nitrilo M'); // 7 / 10
    expect(await prisma.alertaStock.count({ where: { insumoId: guantes.id, revisada: false } })).toBe(1);
  });

  it('revisada por error → «Volver a pendiente» (queda en la auditoría); no si ya se repuso', async () => {
    const admin = await sesion('administrador');
    const guantes = await insumo('Guantes de nitrilo M');
    const alerta = await prisma.alertaStock.findFirstOrThrow({ where: { insumoId: guantes.id } });
    await admin.patch(`/api/alertas/${alerta.id}/revisar`);
    const r = await admin.patch(`/api/alertas/${alerta.id}/reabrir`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ revisada: false, revisadaPor: null });
    expect(await prisma.auditoria.count({ where: { accion: 'reabrir_alerta' } })).toBe(1);
    // repuesto sobre el mínimo → la alerta se cierra sola y ya no se puede reabrir
    await admin.post(`/api/insumos/${guantes.id}/ajuste`).send({ tipo: 'ajuste', cantidad: 20, motivo: 'Conteo físico' });
    const otra = await admin.patch(`/api/alertas/${alerta.id}/reabrir`);
    expect(otra.status).toBe(409);
    expect(otra.body.mensaje).toBe(MENSAJES.ALERTA_NO_REABRIBLE);
  });
});

describe('Razón social con el RUC (SUNAT)', () => {
  const proveedor = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('sin token no consulta; con token devuelve la razón social y avisa si no está activo/habido', async () => {
    const admin = await sesion('administrador');
    expect((await admin.get('/api/sunat/20481234567')).body).toEqual({ encontrado: false, motivo: 'no_configurado' });
    process.env.RENIEC_TOKEN = 't';
    const f = proveedor(200, { razon_social: 'DENTAL NORTE S.A.C.', estado: 'ACTIVO', condicion: 'HABIDO', direccion: 'AV. ESPAÑA 123' });
    expect((await admin.get('/api/sunat/20481234567')).body).toEqual({ encontrado: true, razonSocial: 'DENTAL NORTE S.A.C.', direccion: 'AV. ESPAÑA 123', estado: 'ACTIVO', condicion: 'HABIDO', aviso: null });
    expect(f.mock.calls[0][0]).toBe('https://api.decolecta.com/v1/sunat/ruc?numero=20481234567');
    vi.restoreAllMocks();
    proveedor(200, { razonSocial: 'X E.I.R.L.', estado: 'BAJA DE OFICIO', condicion: 'NO HABIDO' });
    expect((await admin.get('/api/sunat/20481234567')).body.aviso).toBe('Este RUC figura como BAJA DE OFICIO / NO HABIDO en SUNAT');
  });

  it('valida el RUC y solo el Administrador lo usa', async () => {
    expect((await (await sesion('administrador')).get('/api/sunat/2048')).status).toBe(422);
    expect((await (await sesion('recepcionista')).get('/api/sunat/20481234567')).status).toBe(403);
  });
});

describe('Campos numéricos (la API también los valida)', () => {
  it('N.° de operación solo con números; CMP hasta 6 dígitos', async () => {
    const c = await prisma.cita.create({
      data: { pacienteId: await idPaciente('72458190'), odontologoId: await idOdontologo(), fecha: new Date(`${proximo(1)}T00:00:00Z`), hora: new Date('1970-01-01T09:00:00Z'), motivo: 'x', canal: 'web', estado: 'pendiente_adelanto', montoAdelanto: 20, adelantoVenceEn: new Date(Date.now() + 3_600_000), creadoPorId: (await prisma.usuario.findFirstOrThrow()).id },
    });
    const r = await (await sesion('paciente')).post(`/api/citas/${c.id}/pago`).send({ metodo: 'yape', numeroOperacion: 'AB-12' });
    expect(r.status).toBe(422);
    const admin = await sesion('administrador');
    const u = await admin.post('/api/usuarios').send({ nombres: 'Dra. Prueba', email: 'prueba@clinica.local', rol: 'odontologo', password: 'Clinica2026', cmp: 'CMP-1234567' });
    expect(u.body.campos.cmp).toBe('El CMP tiene hasta 6 dígitos');
  });
});

describe('Vigencia del saldo a favor', () => {
  const abonar = async (monto: number, haceDias = 0) => {
    const pacienteId = await idPaciente('72458190');
    const admin = await prisma.usuario.findFirstOrThrow({ where: { rol: 'administrador' } });
    const m = await prisma.$transaction((tx) => moverSaldo(tx, { pacienteId, tipo: 'abono_cancelacion', monto, usuarioId: admin.id }));
    if (haceDias) await prisma.saldoMovimiento.update({ where: { id: m!.id }, data: { venceEn: new Date(Date.now() - haceDias * 86_400_000) } });
    return m!;
  };
  const saldo = async () => (await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } })).saldoFavor.toFixed(2);

  it('cada abono vence a los 12 meses; «Mis datos» muestra los vencimientos', async () => {
    const a = await abonar(30);
    const meses = (a.venceEn!.getTime() - Date.now()) / (30.4 * 86_400_000);
    expect(meses).toBeGreaterThan(11.8);
    expect(meses).toBeLessThan(12.2);
    const yo = (await (await sesion('paciente')).get('/api/pacientes/me')).body;
    expect(yo.saldoFavor).toBe('30.00');
    expect(yo.saldoVencimientos).toEqual([{ monto: '30.00', venceEn: a.venceEn!.toISOString() }]);
  });

  it('se usa primero lo que vence antes', async () => {
    const viejo = await abonar(10);
    await prisma.saldoMovimiento.update({ where: { id: viejo.id }, data: { venceEn: new Date(Date.now() + 5 * 86_400_000) } });
    const nuevo = await abonar(25);
    const pacienteId = await idPaciente('72458190');
    const admin = await prisma.usuario.findFirstOrThrow({ where: { rol: 'administrador' } });
    await prisma.$transaction((tx) => moverSaldo(tx, { pacienteId, tipo: 'uso_en_cobro', monto: -15, usuarioId: admin.id }));
    expect((await prisma.saldoMovimiento.findUniqueOrThrow({ where: { id: viejo.id } })).restante!.toFixed(2)).toBe('0.00');
    expect((await prisma.saldoMovimiento.findUniqueOrThrow({ where: { id: nuevo.id } })).restante!.toFixed(2)).toBe('20.00');
    expect(await saldo()).toBe('20.00');
  });

  it('la tarea diaria vence lo que cumplió su plazo y avisa 30 y 7 días antes (una vez cada aviso)', async () => {
    await abonar(10, 1); // venció ayer
    const pronto = await abonar(25);
    await prisma.saldoMovimiento.update({ where: { id: pronto.id }, data: { venceEn: new Date(Date.now() + 20 * 86_400_000) } });
    expect(await revisarSaldos()).toEqual({ vencidos: 1, avisos: 1 }); // aviso de 30 días
    expect(await saldo()).toBe('25.00');
    expect(await prisma.saldoMovimiento.count({ where: { tipo: 'vencimiento' } })).toBe(1);
    expect(await revisarSaldos()).toEqual({ vencidos: 0, avisos: 0 }); // no se repite
    await prisma.saldoMovimiento.update({ where: { id: pronto.id }, data: { venceEn: new Date(Date.now() + 5 * 86_400_000) } });
    expect((await revisarSaldos()).avisos).toBe(1); // aviso de 7 días
  });

  it('con vigencia 0 meses el saldo no vence; se configura en Configuración → Pagos', async () => {
    const admin = await sesion('administrador');
    const r = await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica Dental', billeteras: ['yape'], saldoVigenciaMeses: 0 });
    expect(r.body.saldoVigenciaMeses).toBe(0);
    expect((await abonar(30)).venceEn).toBeNull();
    expect((await admin.put('/api/admin/pago').send({ numero: '987654321', titular: 'Clínica Dental', billeteras: ['yape'], saldoVigenciaMeses: 99 })).status).toBe(422);
  });
});
