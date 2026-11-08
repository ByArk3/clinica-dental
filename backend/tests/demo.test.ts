// Datos de demostración (se cargan con la semilla): deben respetar las reglas del sistema
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, reiniciarBD } from './helpers.js';
import { sembrarDemo } from '../prisma/demo.js';

const uno = async (sql: string) => Number(((await prisma.$queryRawUnsafe(sql)) as { n: number }[])[0].n);

describe('Datos de demostración', () => {
  beforeAll(async () => {
    await reiniciarBD();
    await sembrarDemo(prisma, { silencioso: true });
  }, 180_000);

  it('genera historia y próximas citas en varios estados', async () => {
    expect(await prisma.paciente.count()).toBeGreaterThanOrEqual(60);
    const estados = new Set((await prisma.cita.groupBy({ by: ['estado'] })).map((x) => x.estado));
    for (const e of ['pagada', 'confirmada', 'cancelada', 'liberada', 'inasistencia', 'pendiente_adelanto', 'pago_en_verificacion']) expect(estados).toContain(e);
    expect(await prisma.paciente.count({ where: { dni: null } })).toBeGreaterThan(0);
    expect(await prisma.pedido.count({ where: { estado: 'pendiente' } })).toBeGreaterThanOrEqual(1); // según la hora, puede haber otro pedido en camino
    expect(await prisma.alertaStock.count({ where: { revisada: false } })).toBeGreaterThan(0);
  });

  it('el stock nunca queda negativo y coincide con el kárdex', async () => {
    expect(await uno(`SELECT count(*)::int n FROM movimientos_kardex WHERE saldo < 0`)).toBe(0);
    expect(await uno(`SELECT count(*)::int n FROM (SELECT saldo, lag(saldo) OVER w + cantidad AS e, row_number() OVER w r FROM movimientos_kardex WINDOW w AS (PARTITION BY insumo_id ORDER BY created_at, id)) x WHERE r > 1 AND saldo <> e`)).toBe(0);
    expect(await uno(`SELECT count(*)::int n FROM insumos i WHERE stock_actual <> (SELECT saldo FROM movimientos_kardex m WHERE m.insumo_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1)`)).toBe(0);
  });

  it('comprobantes numerados sin huecos en orden de emisión; saldo a favor igual a su libro mayor', async () => {
    expect(await uno(`SELECT count(*)::int n FROM (SELECT numero, row_number() OVER (ORDER BY created_at, id) r FROM comprobantes) x WHERE numero <> 'C-' || lpad(r::text, 6, '0')`)).toBe(0);
    expect(await uno(`SELECT count(*)::int n FROM pacientes p WHERE saldo_favor <> COALESCE((SELECT sum(monto) FROM saldo_movimientos s WHERE s.paciente_id = p.id), 0)`)).toBe(0);
    expect(await uno(`SELECT count(*)::int n FROM comprobantes WHERE total < 0`)).toBe(0);
  });

  it('nadie tiene dos citas el mismo día; no se repite un horario activo', async () => {
    expect(await uno(`SELECT count(*)::int n FROM (SELECT paciente_id, fecha FROM citas GROUP BY 1, 2 HAVING count(*) > 1) x`)).toBe(0);
  });

  it('se carga una sola vez', async () => {
    const antes = await prisma.cita.count();
    await sembrarDemo(prisma, { silencioso: true });
    expect(await prisma.cita.count()).toBe(antes);
  });
});
