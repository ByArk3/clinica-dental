// Registro de auditoría: quién vio el historial clínico de cada paciente y cuándo,
// además de ediciones de atenciones, anulaciones de comprobantes y bloqueos de inicio de sesión.
import type { AccionAuditoria, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma.js';

export interface EventoAuditoria {
  usuarioId?: number | null;
  accion: AccionAuditoria;
  pacienteId?: number | null;
  detalle?: string;
  ip?: string;
}

export function registrar(db: Tx | typeof prisma, e: EventoAuditoria) {
  return db.auditoria.create({
    data: { usuarioId: e.usuarioId ?? null, accion: e.accion, pacienteId: e.pacienteId ?? null, detalle: e.detalle?.slice(0, 500), ip: e.ip?.slice(0, 64) },
  });
}

/** Consulta del Administrador: filtros por paciente (DNI), usuario, acción y rango de fechas (hora de Lima). */
export async function listar(f: { dni?: string; usuarioId?: number; accion?: AccionAuditoria; desde: string; hasta: string }) {
  const where: Prisma.AuditoriaWhereInput = {
    createdAt: { gte: new Date(`${f.desde}T00:00:00-05:00`), lt: new Date(new Date(`${f.hasta}T00:00:00-05:00`).getTime() + 86_400_000) },
    ...(f.dni ? { paciente: { dni: f.dni } } : {}),
    ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
    ...(f.accion ? { accion: f.accion } : {}),
  };
  const LIMITE = 500;
  const filas = await prisma.auditoria.findMany({
    where,
    orderBy: { id: 'desc' },
    take: LIMITE + 1,
    include: {
      usuario: { select: { id: true, nombres: true, email: true, rol: true } },
      paciente: { select: { id: true, dni: true, nombres: true, apellidos: true } },
    },
  });
  return {
    eventos: filas.slice(0, LIMITE).map((a) => ({
      id: a.id,
      fecha: a.createdAt.toISOString(),
      accion: a.accion,
      usuario: a.usuario ? { id: a.usuario.id, nombres: a.usuario.nombres, email: a.usuario.email, rol: a.usuario.rol } : null,
      paciente: a.paciente ? { id: a.paciente.id, dni: a.paciente.dni, nombres: `${a.paciente.apellidos}, ${a.paciente.nombres}` } : null,
      detalle: a.detalle,
      ip: a.ip,
    })),
    hayMas: filas.length > LIMITE,
  };
}
