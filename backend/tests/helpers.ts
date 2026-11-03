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

/**
 * Crea una cita directamente en la BD a `horas` de ahora (redondeada a la media hora, hora de Lima).
 * Útil para probar plazos (24 h / 48 h) e inasistencias sin depender del horario de atención.
 */
export async function crearCita(opciones: {
  horas: number;
  estado?: 'pendiente_confirmacion' | 'pendiente_adelanto' | 'confirmada' | 'atendida' | 'cancelada' | 'liberada';
  dni?: string;
  odontologoEmail?: string;
  token?: string;
}) {
  const instante = new Date(Date.now() + opciones.horas * 3_600_000);
  const { fecha, hora } = ahoraLima(instante);
  const [h, m] = hora.split(':').map(Number);
  const horaRedondeada = `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`;
  const creador = await prisma.usuario.findFirstOrThrow({ where: { rol: 'recepcionista' } });
  return prisma.cita.create({
    data: {
      pacienteId: await idPaciente(opciones.dni ?? '72458190'),
      odontologoId: await idOdontologo(opciones.odontologoEmail),
      fecha: new Date(`${fecha}T00:00:00Z`),
      hora: new Date(`1970-01-01T${horaRedondeada}:00Z`),
      motivo: 'Prueba',
      canal: 'presencial',
      estado: opciones.estado ?? 'pendiente_confirmacion',
      tokenConfirmacion: opciones.token ?? `tok${Math.random().toString(16).slice(2)}${Date.now()}`,
      creadoPorId: creador.id,
    },
  });
}
