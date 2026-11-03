// Insumos (CU-18 a CU-21) y CU-22 Buscar insumo. El stock solo cambia vía StockService.
import { Prisma } from '@prisma/client';
import { MENSAJES, type AjusteDTO, type InsumoDTO, type InsumoNuevoDTO } from '@clinica/shared';
import type { TipoMovimiento } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';
import { registrarMovimiento } from './stock.service.js';

type Insumo = Prisma.InsumoGetPayload<object>;
const formatear = (i: Insumo) => ({
  id: i.id,
  nombre: i.nombre,
  unidad: i.unidad,
  stockActual: i.stockActual.toFixed(2),
  stockMinimo: i.stockMinimo.toFixed(2),
  bajoMinimo: i.stockActual.lessThanOrEqualTo(i.stockMinimo),
  activo: i.activo,
});

const noEncontrado = () => new ErrorNegocio(404, 'INSUMO_NO_ENCONTRADO', MENSAJES.INSUMO_NO_ENCONTRADO);
const duplicado = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ErrorNegocio(409, 'INSUMO_DUPLICADO', MENSAJES.INSUMO_DUPLICADO, { nombre: MENSAJES.INSUMO_DUPLICADO })
    : e;

/** CU-19 Listar insumos / CU-22 Buscar insumo. */
export async function listar(filtro: { q?: string; activo?: boolean; bajoMinimo?: boolean }) {
  const lista = await prisma.insumo.findMany({
    where: {
      ...(filtro.activo !== undefined ? { activo: filtro.activo } : {}),
      ...(filtro.q ? { nombre: { contains: filtro.q, mode: 'insensitive' } } : {}),
    },
    orderBy: { nombre: 'asc' },
  });
  const r = lista.map(formatear);
  return filtro.bajoMinimo ? r.filter((i) => i.bajoMinimo) : r;
}

/** CU-18 Registrar insumo: el stock inicial queda como primer movimiento del kárdex. */
export async function crear(dto: InsumoNuevoDTO, usuarioId: number) {
  try {
    return formatear(
      await prisma.$transaction(async (tx) => {
        const insumo = await tx.insumo.create({
          data: { nombre: dto.nombre, unidad: dto.unidad, stockMinimo: dto.stockMinimo, stockActual: 0 },
        });
        await registrarMovimiento(tx, { insumoId: insumo.id, tipo: 'inicial', cantidad: dto.stockInicial, usuarioId, motivo: 'Inventario inicial' });
        return tx.insumo.findUniqueOrThrow({ where: { id: insumo.id } });
      }),
    );
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-20 Modificar insumo. El stock actual NO se edita aquí (solo por recepción o ajuste). */
export async function modificar(id: number, dto: InsumoDTO) {
  if (!(await prisma.insumo.findUnique({ where: { id } }))) throw noEncontrado();
  try {
    return formatear(
      await prisma.insumo.update({ where: { id }, data: { nombre: dto.nombre, unidad: dto.unidad, stockMinimo: dto.stockMinimo } }),
    );
  } catch (e) {
    throw duplicado(e);
  }
}

/** CU-21 Desactivar (borrado lógico). No si lo usa un tratamiento activo. */
export async function cambiarEstado(id: number, activo: boolean) {
  if (!(await prisma.insumo.findUnique({ where: { id } }))) throw noEncontrado();
  if (!activo) {
    const usos = await prisma.tratamiento.findMany({
      where: { activo: true, insumos: { some: { insumoId: id } } },
      select: { nombre: true },
    });
    if (usos.length > 0) {
      throw new ErrorNegocio(409, 'INSUMO_EN_USO', `${MENSAJES.INSUMO_EN_USO} (${usos.map((u) => u.nombre).join(', ')})`);
    }
  }
  return formatear(await prisma.insumo.update({ where: { id }, data: { activo } }));
}

/**
 * CU-23 Consultar kárdex: movimientos del insumo, filtrables por rango de fechas (hora de Lima) y tipo.
 * Fechas inclusive: desde 00:00 hasta 23:59 del día `hasta`.
 */
export async function kardex(id: number, f: { desde?: string; hasta?: string; tipo?: TipoMovimiento } = {}) {
  const insumo = await prisma.insumo.findUnique({ where: { id } });
  if (!insumo) throw noEncontrado();
  const movimientos = await prisma.movimientoKardex.findMany({
    where: {
      insumoId: id,
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(f.desde || f.hasta
        ? {
            createdAt: {
              ...(f.desde ? { gte: new Date(`${f.desde}T00:00:00-05:00`) } : {}),
              ...(f.hasta ? { lt: new Date(new Date(`${f.hasta}T00:00:00-05:00`).getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    },
    orderBy: { id: 'desc' },
    take: 500,
    include: { usuario: { select: { nombres: true } } },
  });
  return {
    insumo: formatear(insumo),
    movimientos: movimientos.map((m) => ({
      id: m.id,
      fecha: m.createdAt.toISOString(),
      tipo: m.tipo,
      cantidad: m.cantidad.toFixed(2),
      saldo: m.saldo.toFixed(2),
      motivo: m.motivo,
      referencia: m.referenciaTipo ? `${m.referenciaTipo} #${m.referenciaId}` : null,
      usuario: m.usuario.nombres,
    })),
  };
}

/** CU-24 Revisar alertas de stock mínimo (RN-14): pendientes por defecto, o todas. */
export async function alertas(f: { revisada?: boolean } = { revisada: false }) {
  const lista = await prisma.alertaStock.findMany({
    where: f.revisada !== undefined ? { revisada: f.revisada } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { insumo: true, revisadaPor: { select: { nombres: true } } },
  });
  return lista.map((a) => ({
    id: a.id,
    fecha: a.createdAt.toISOString(),
    stockAlGenerar: a.stockAlGenerar.toFixed(2),
    revisada: a.revisada,
    revisadaPor: a.revisadaPor?.nombres ?? null,
    revisadaEn: a.revisadaEn?.toISOString() ?? null,
    insumo: formatear(a.insumo),
  }));
}
export const alertasPendientes = () => alertas({ revisada: false });

/** CU-24: marcar una alerta como revisada (queda constancia de quién y cuándo). */
export async function revisarAlerta(id: number, usuarioId: number) {
  const a = await prisma.alertaStock.findUnique({ where: { id } });
  if (!a) throw new ErrorNegocio(404, 'ALERTA_NO_ENCONTRADA', MENSAJES.ALERTA_NO_ENCONTRADA);
  if (!a.revisada) {
    await prisma.alertaStock.update({ where: { id }, data: { revisada: true, revisadaPorId: usuarioId, revisadaEn: new Date() } });
  }
  return (await alertas({})).find((x) => x.id === id)!;
}

/**
 * CU-25 Registrar ajuste de stock (RN-13: solo el Administrador). Pasa por StockService (CU-12).
 * ajuste: cantidad con signo (conteo físico); merma: resta (vencimiento P11, rotura, pérdida).
 * A diferencia de la salida por tratamiento, un ajuste que deja stock negativo se rechaza.
 */
export async function registrarAjuste(id: number, d: AjusteDTO, usuarioId: number) {
  return prisma.$transaction(async (tx) => {
    const [fila] = await tx.$queryRaw<{ stock_actual: Prisma.Decimal }[]>`SELECT stock_actual FROM insumos WHERE id = ${id} FOR UPDATE`;
    if (!fila) throw noEncontrado();
    const delta = d.tipo === 'merma' ? -d.cantidad : d.cantidad;
    if (new Prisma.Decimal(fila.stock_actual).plus(delta).isNegative()) {
      throw new ErrorNegocio(422, 'AJUSTE_NEGATIVO', MENSAJES.AJUSTE_NEGATIVO, { cantidad: MENSAJES.AJUSTE_NEGATIVO });
    }
    const r = await registrarMovimiento(tx, { insumoId: id, tipo: d.tipo, cantidad: d.cantidad, motivo: d.motivo, usuarioId, referencia: { tipo: 'ajuste', id } });
    return { ...r, insumo: formatear(await tx.insumo.findUniqueOrThrow({ where: { id } })) };
  });
}
