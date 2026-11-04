import { PrismaClient } from '@prisma/client';

// La captura del pago (imagen) no se carga en cada consulta de citas: se pide explícitamente.
export const prisma = new PrismaClient({ omit: { cita: { pagoCaptura: true } } });
/** Cliente dentro de prisma.$transaction(async (tx) => …) */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
