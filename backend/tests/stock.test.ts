import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, reiniciarBD } from './helpers.js';
import { registrarMovimiento } from '../src/services/stock.service.js';

beforeEach(reiniciarBD);

const insumo = (nombre: string) => prisma.insumo.findUniqueOrThrow({ where: { nombre } });
const admin = () => prisma.usuario.findFirstOrThrow({ where: { rol: 'administrador' } });

describe('CU-12 StockService.registrarMovimiento', () => {
  it('salida: descuenta el stock y escribe el kárdex con el saldo', async () => {
    const i = await insumo('Anestesia lidocaína 2 %'); // 18, mínimo 10
    const u = await admin();
    const r = await prisma.$transaction((tx) =>
      registrarMovimiento(tx, { insumoId: i.id, tipo: 'salida_tratamiento', cantidad: 2, usuarioId: u.id, referencia: { tipo: 'atencion', id: 7 } }),
    );
    expect(r).toMatchObject({ cantidad: '-2.00', saldo: '16.00', alertaGenerada: false });
    expect((await insumo('Anestesia lidocaína 2 %')).stockActual.toFixed(2)).toBe('16.00');
    const k = await prisma.movimientoKardex.findFirstOrThrow({ where: { insumoId: i.id }, orderBy: { id: 'desc' } });
    expect(k).toMatchObject({ tipo: 'salida_tratamiento', referenciaTipo: 'atencion', referenciaId: 7 });
    expect(k.saldo.toFixed(2)).toBe('16.00');
  });

  it('entrada: suma al stock', async () => {
    const i = await insumo('Guantes de nitrilo M'); // 7
    const r = await prisma.$transaction(async (tx) => registrarMovimiento(tx, { insumoId: i.id, tipo: 'entrada_recepcion', cantidad: '10.5', usuarioId: (await admin()).id }));
    expect(r.saldo).toBe('17.50');
  });

  it('RN-14: al llegar al mínimo genera UNA alerta (no se duplica mientras no se revise)', async () => {
    const i = await insumo('Copa de goma'); // 12, mínimo 5
    const u = await admin();
    const salida = (c: number) => prisma.$transaction((tx) => registrarMovimiento(tx, { insumoId: i.id, tipo: 'salida_tratamiento', cantidad: c, usuarioId: u.id }));
    expect((await salida(6)).alertaGenerada).toBe(false); // 6 > 5
    expect((await salida(1)).alertaGenerada).toBe(true); // 5 = mínimo
    expect((await salida(1)).alertaGenerada).toBe(false); // ya hay una abierta
    expect(await prisma.alertaStock.count({ where: { insumoId: i.id } })).toBe(1);
    await prisma.alertaStock.updateMany({ data: { revisada: true } });
    expect((await salida(1)).alertaGenerada).toBe(true);
  });

  it('salida mayor al stock: deja 0, registra la observación del faltante (CU-12)', async () => {
    const i = await insumo('Gel blanqueador'); // 4
    const r = await prisma.$transaction(async (tx) => registrarMovimiento(tx, { insumoId: i.id, tipo: 'salida_tratamiento', cantidad: 6, usuarioId: (await admin()).id }));
    expect(r).toMatchObject({ cantidad: '-4.00', saldo: '0.00', faltante: '2.00', alertaGenerada: true });
    const k = await prisma.movimientoKardex.findFirstOrThrow({ where: { insumoId: i.id }, orderBy: { id: 'desc' } });
    expect(k.motivo).toContain('faltaron 2.00 jeringa');
  });

  it('si la transacción falla, el stock y el kárdex no cambian', async () => {
    const i = await insumo('Gasa estéril');
    const antes = await prisma.movimientoKardex.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await registrarMovimiento(tx, { insumoId: i.id, tipo: 'salida_tratamiento', cantidad: 3, usuarioId: (await admin()).id });
        throw new Error('falla posterior');
      }),
    ).rejects.toThrow('falla posterior');
    expect((await insumo('Gasa estéril')).stockActual.toFixed(2)).toBe('20.00');
    expect(await prisma.movimientoKardex.count()).toBe(antes);
  });

  it('salidas simultáneas del mismo insumo no pierden ninguna (bloqueo de fila)', async () => {
    const i = await insumo('Gasa estéril'); // 20
    const u = await admin();
    await Promise.all(
      Array.from({ length: 5 }, () => prisma.$transaction((tx) => registrarMovimiento(tx, { insumoId: i.id, tipo: 'salida_tratamiento', cantidad: 2, usuarioId: u.id }))),
    );
    expect((await insumo('Gasa estéril')).stockActual.toFixed(2)).toBe('10.00');
    const saldos = (await prisma.movimientoKardex.findMany({ where: { insumoId: i.id, tipo: 'salida_tratamiento' } })).map((m) => m.saldo.toFixed(2)).sort();
    expect(saldos).toEqual(['10.00', '12.00', '14.00', '16.00', '18.00']);
  });
});
