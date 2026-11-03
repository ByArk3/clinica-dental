import cron from 'node-cron';
import { enviarRecordatorios, liberarCitas } from './citas.jobs.js';

const ejecutar = (nombre: string, tarea: () => Promise<unknown>) => async () => {
  try {
    const r = await tarea();
    console.info(`[tarea] ${nombre}`, JSON.stringify(r));
  } catch (e) {
    console.error(`[tarea] ${nombre} falló:`, e instanceof Error ? e.message : e);
  }
};

/** Sección 11: cada 15 min, en hora de Lima. Primero se libera y luego se recuerda. */
export function iniciarTareas() {
  cron.schedule(
    '*/15 * * * *',
    async () => {
      await ejecutar('liberar citas (RN-04)', liberarCitas)();
      await ejecutar('enviar recordatorios (CU-08)', enviarRecordatorios)();
    },
    { timezone: 'America/Lima' },
  );
  console.info('[tarea] programadas: liberar citas y recordatorios cada 15 min');
}
