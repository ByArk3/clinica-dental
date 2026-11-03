import request from 'supertest';
import { crearApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { sembrar, PASSWORD } from '../prisma/seed.js';
import { ahoraLima, sumarDias, diaSemana } from '../src/lib/fechas.js';

export const app = crearApp();
export { prisma, PASSWORD };

export const USUARIOS = {
  recepcionista: 'ana.rios@clinica.local',
  administrador: 'carlos.vega@clinica.local',
  odontologo: 'luis.paredes@clinica.local',
  paciente: 'maria.quispe@correo.local',
} as const;

/** Vacía todas las tablas (menos las migraciones) y vuelve a cargar la semilla. */
export async function reiniciarBD() {
  const tablas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tablas.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await sembrar(prisma, { silencioso: true });
}

/** Agente con la sesión iniciada para el rol indicado. */
export async function sesion(rol: keyof typeof USUARIOS) {
  const agente = request.agent(app);
  const r = await agente.post('/api/auth/login').send({ email: USUARIOS[rol], password: PASSWORD });
  if (r.status !== 200) throw new Error(`No se pudo iniciar sesión como ${rol}: ${r.status}`);
  return agente;
}

/** Próxima fecha (en Lima) que cae en el día de semana indicado (1 = lunes), al menos `minDias` días después de hoy. */
export function proximo(dia: number, minDias = 3) {
  let f = sumarDias(ahoraLima().fecha, minDias);
  while (diaSemana(f) !== dia) f = sumarDias(f, 1);
  return f;
}

export async function idOdontologo(email: string = USUARIOS.odontologo) {
  const o = await prisma.odontologo.findFirstOrThrow({ where: { usuario: { email } } });
  return o.id;
}

export async function idPaciente(dni: string) {
  return (await prisma.paciente.findUniqueOrThrow({ where: { dni } })).id;
}
