import cron from 'node-cron';
import { enviarRecordatorios, liberarCitas, revisarSaldos } from './citas.jobs.js';

const ejecutar = (nombre: string, tarea: () => Promise<unknown>) => async () => {
  try {
    const r = await tarea();
    console.info(`[tarea] ${nombre}`, JSON.stringify(r));
  } catch (e) {
    console.error(`[tarea] ${nombre} falló:`, e instanceof Error ? e.message : e);
  }
};

/** Cada 5 min (el adelanto vence en 1 hora), en hora de Lima. Primero se libera y luego se recuerda. */
export function iniciarTareas() {
  cron.schedule(
    '*/5 * * * *',
    async () => {
      await ejecutar('liberar citas (RN-04)', liberarCitas)();
      await ejecutar('enviar recordatorios (CU-08)', enviarRecordatorios)();
    },
    { timezone: 'America/Lima' },
  );
  // Saldo a favor: vencimientos y avisos, una vez al día (07:10, hora de Lima)
  cron.schedule(
    '10 7 * * *',
    async () => {
      await ejecutar('saldo a favor (vencimientos y avisos)', revisarSaldos)();
    },
    { timezone: 'America/Lima' },
  );
  console.info('[tarea] programadas: liberar citas y recordatorios cada 5 min; saldo a favor a diario');
}
