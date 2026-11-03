// Insumos (CU-18 a CU-21) y CU-22 Buscar insumo. El stock solo cambia vía StockService.
import { Prisma } from '@prisma/client';
import { MENSAJES, type InsumoDTO, type InsumoNuevoDTO } from '@clinica/shared';
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

/** Kárdex del insumo (lectura; la consulta completa con filtros es CU-23, iteración 4). */
export async function kardex(id: number) {
  const insumo = await prisma.insumo.findUnique({ where: { id } });
  if (!insumo) throw noEncontrado();
  const movimientos = await prisma.movimientoKardex.findMany({
    where: { insumoId: id },
    orderBy: { id: 'desc' },
    take: 200,
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

/** Alertas de stock mínimo sin revisar (RN-14). La revisión es CU-24 (iteración 4). */
export async function alertasPendientes() {
  const alertas = await prisma.alertaStock.findMany({
    where: { revisada: false },
    orderBy: { createdAt: 'desc' },
    include: { insumo: true },
  });
  return alertas.map((a) => ({
    id: a.id,
    fecha: a.createdAt.toISOString(),
    stockAlGenerar: a.stockAlGenerar.toFixed(2),
    insumo: formatear(a.insumo),
  }));
}
