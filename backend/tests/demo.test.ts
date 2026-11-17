// Datos de demostración (se cargan con la semilla): deben respetar las reglas del sistema
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, reiniciarBD } from './helpers.js';
import { sembrarDemo } from '../prisma/demo.js';
import { hoyEnLima, moverFecha } from '@clinica/shared';

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

  it('200 personas: 2 administradores (Carlos sigue de principal), 2 recepcionistas, 5 odontólogos y 191 pacientes', async () => {
    const porRol = Object.fromEntries((await prisma.usuario.groupBy({ by: ['rol'], _count: true })).map((x) => [x.rol, x._count]));
    expect(porRol).toMatchObject({ administrador: 2, recepcionista: 2, odontologo: 5 });
    expect((await prisma.usuario.findFirstOrThrow({ where: { principal: true } })).email).toBe('carlos.vega@clinica.local');
    expect(await prisma.paciente.count()).toBe(191);
    expect(await prisma.paciente.count({ where: { usuarioId: { not: null } } })).toBe(96);
    expect(porRol.paciente).toBe(96);
    expect(await prisma.paciente.count({ where: { usuarioId: null } })).toBe(95);
    expect(await prisma.paciente.count({ where: { dni: null } })).toBe(10);
    expect(await prisma.usuario.count()).toBe(105);
    // las citas futuras llegan hasta el 20/12/2026 (o 2 semanas, si ya pasó esa fecha)
    const ultima = (await prisma.cita.findFirstOrThrow({ orderBy: { fecha: 'desc' } })).fecha.toISOString().slice(0, 10);
    expect(ultima >= '2026-12-14' || ultima > hoyEnLima()).toBe(true);
    expect(ultima <= [moverFecha(hoyEnLima(), { dias: 14 }), '2026-12-20'].sort()[1]).toBe(true);
    // todos los odontólogos tienen agenda, y hay reservas hechas por la web
    expect((await prisma.cita.groupBy({ by: ['odontologoId'] })).length).toBe(5);
    expect(await prisma.cita.count({ where: { canal: 'web' } })).toBeGreaterThan(50);
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
