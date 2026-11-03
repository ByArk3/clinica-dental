import { prisma } from '../lib/prisma.js';

export async function listarOdontologosActivos() {
  const lista = await prisma.odontologo.findMany({
    where: { activo: true, usuario: { activo: true } },
    include: { usuario: { select: { nombres: true } } },
    orderBy: { id: 'asc' },
  });
  return lista.map((o) => ({ id: o.id, nombres: o.usuario.nombres, especialidad: o.especialidad }));
}
