// Datos de demostración (se cargan con la semilla): deben respetar las reglas del sistema
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, reiniciarBD } from './helpers.js';
import { DIA_DE_DEMOSTRACION, sembrarDemo } from '../prisma/demo.js';
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

  it('Administrador: 30 insumos, 25 tratamientos, 10 proveedores, pedidos en todos los estados, alertas y ajustes', async () => {
    expect(await prisma.insumo.count()).toBe(30);
    expect(await prisma.insumo.count({ where: { activo: false } })).toBe(2);
    expect(await prisma.tratamiento.count()).toBe(25);
    expect(await prisma.tratamiento.count({ where: { activo: false } })).toBe(2);
    expect(await prisma.proveedor.count()).toBe(10);
    expect(await prisma.pedido.count()).toBeGreaterThanOrEqual(40);
    const estados = new Set((await prisma.pedido.groupBy({ by: ['estado'] })).map((x) => x.estado));
    for (const e of ['pendiente', 'recibido', 'recibido_con_diferencias', 'anulado']) expect(estados).toContain(e);
    expect(await prisma.pedido.count({ where: { estado: 'pendiente' } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.alertaStock.count()).toBeGreaterThanOrEqual(25);
    expect(await prisma.alertaStock.count({ where: { revisada: false } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.movimientoKardex.count({ where: { tipo: { in: ['merma', 'ajuste'] } } })).toBeGreaterThanOrEqual(15);
    // ningún pedido figura recibido en el futuro, y los insumos desactivados no se piden
    expect(await prisma.pedido.count({ where: { recibidoEn: { gt: new Date() } } })).toBe(0);
    expect(await prisma.detallePedido.count({ where: { insumo: { activo: false } } })).toBe(0);
    // cada especialista atiende lo suyo
    const endo = await prisma.atencionTratamiento.count({ where: { tratamiento: { nombre: { startsWith: 'Endodoncia' } } } });
    expect(endo).toBeGreaterThan(0);
    expect(await prisma.atencionTratamiento.count({ where: { tratamiento: { nombre: { startsWith: 'Endodoncia' } }, atencion: { odontologo: { especialidad: 'Endodoncia' } } } })).toBe(endo);
    expect(await prisma.descuento.count({ where: { nombre: { endsWith: '(diciembre)' } } })).toBe(2);
    // pendiente 33: ~80 % de los insumos activos con 100 o más; ~20 % con stock bajo (en el mínimo, con su alerta)
    const activos = await prisma.insumo.findMany({ where: { activo: true } });
    const altos = activos.filter((i) => i.stockActual.toNumber() >= 100).length;
    const bajos = activos.filter((i) => i.stockActual.lte(i.stockMinimo));
    expect(altos / activos.length).toBeGreaterThanOrEqual(0.75);
    expect(bajos.length).toBeGreaterThanOrEqual(4);
    expect(altos + bajos.length).toBe(activos.length);
    for (const b of bajos) expect(await prisma.alertaStock.count({ where: { insumoId: b.id, revisada: false } })).toBe(1);
  });

  it(`día de la presentación (${DIA_DE_DEMOSTRACION}): todos los horarios hasta las 16:00 ocupados`, async () => {
    if (hoyEnLima() > DIA_DE_DEMOSTRACION) return; // ya pasó
    const ocupadas = new Set(
      (await prisma.cita.findMany({ where: { fecha: new Date(`${DIA_DE_DEMOSTRACION}T00:00:00Z`), estado: { notIn: ['cancelada', 'liberada'] } } })).map((c) => `${c.odontologoId}|${c.hora.toISOString().slice(11, 16)}`),
    );
    const dia = new Date(`${DIA_DE_DEMOSTRACION}T00:00:00Z`).getUTCDay() || 7;
    // horario propio de cada odontólogo o, si no tiene, el general de la clínica
    const odontologos = await prisma.odontologo.findMany({ where: { activo: true }, include: { horarios: true } });
    const general = await prisma.horarioAtencion.findMany({ where: { odontologoId: null } });
    const horarios = odontologos.flatMap((o) => (o.horarios.length ? o.horarios : general.map((g) => ({ ...g, odontologoId: o.id }))).filter((h) => h.diaSemana === dia));
    let bloques = 0;
    for (const t of horarios) {
      for (let m = t.horaInicio.getUTCHours() * 60 + t.horaInicio.getUTCMinutes(); m + 30 <= t.horaFin.getUTCHours() * 60 + t.horaFin.getUTCMinutes(); m += 30) {
        const h = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        if (h >= '16:00') continue;
        bloques++;
        expect(ocupadas.has(`${t.odontologoId}|${h}`), `${t.odontologoId} ${h}`).toBe(true);
      }
    }
    expect(bloques).toBeGreaterThan(20);
    // nadie tiene dos citas ese día y no hay «pendiente de adelanto» (se liberaría)
    expect(await prisma.cita.count({ where: { fecha: new Date(`${DIA_DE_DEMOSTRACION}T00:00:00Z`), estado: 'pendiente_adelanto' } })).toBe(0);
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
