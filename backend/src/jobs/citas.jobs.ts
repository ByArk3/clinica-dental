// Tareas programadas de la agenda (sección 11 del brief). Reciben `ahora` para poder probarlas.
import { prisma } from '../lib/prisma.js';
import { enviarCorreo } from '../lib/correo.js';
import { dateAFecha, dateAHora, fechaPE } from '../lib/fechas.js';
import { enlaceConfirmacion } from '../services/cita.service.js';

// Instante real de la cita: fecha + hora locales de Lima
const INSTANTE = `(c.fecha + c.hora) AT TIME ZONE 'America/Lima'`;

/**
 * CU-08 paso 1 (c_enviarRecordatorio): citas «Pendiente de confirmación» que empiezan dentro de las
 * próximas 48 h (y faltan más de 24 h) y aún no tienen recordatorio → correo con el enlace.
 * Sin correo, la recepcionista lo envía por WhatsApp desde «Citas del día» (P7).
 */
export async function enviarRecordatorios(ahora = new Date()) {
  const ids = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT c.id FROM citas c
      WHERE c.estado = 'pendiente_confirmacion' AND c.recordatorio_enviado_en IS NULL
        AND ${INSTANTE} <= $1::timestamptz + interval '48 hours'
        AND ${INSTANTE} >  $1::timestamptz + interval '24 hours'`,
    ahora.toISOString(),
  );
  let enviados = 0;
  for (const { id } of ids) {
    const c = await prisma.cita.findUniqueOrThrow({
      where: { id },
      include: { paciente: true, odontologo: { include: { usuario: { select: { nombres: true } } } } },
    });
    if (c.paciente.email && c.tokenConfirmacion) {
      const enlace = enlaceConfirmacion(c.tokenConfirmacion);
      await enviarCorreo(
        c.paciente.email,
        'Confirme su cita — Clínica Dental',
        `<p>Hola ${c.paciente.nombres}:</p>` +
          `<p>Le recordamos su cita del <b>${fechaPE(dateAFecha(c.fecha))} a las ${dateAHora(c.hora)}</b> con ${c.odontologo.usuario.nombres}.</p>` +
          `<p><a href="${enlace}">Confirmar o cancelar mi cita</a></p>` +
          `<p>Si no la confirma hasta 24 horas antes, el horario se libera.</p>`,
      );
      enviados++;
    }
    await prisma.cita.update({ where: { id }, data: { recordatorioEnviadoEn: ahora } });
  }
  return { revisadas: ids.length, enviados };
}

/** RN-04 / CU-08 2.1: citas sin confirmar a menos de 24 h → «Liberada» (el horario queda libre). */
export async function liberarCitas(ahora = new Date()) {
  const filas = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `UPDATE citas c SET estado = 'liberada', updated_at = now()
      WHERE c.estado = 'pendiente_confirmacion' AND ${INSTANTE} < $1::timestamptz + interval '24 hours'
      RETURNING c.id`,
    ahora.toISOString(),
  );
  return filas.map((f) => f.id);
}
