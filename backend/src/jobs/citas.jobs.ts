// Tareas programadas de la agenda (sección 11 del brief). Reciben `ahora` para poder probarlas.
import { prisma } from '../lib/prisma.js';
import { enviarCorreo } from '../lib/correo.js';
import { dateAFecha, dateAHora, fechaPE } from '../lib/fechas.js';
import { enlaceConfirmacion } from '../services/cita.service.js';
import { porAvisar, vencerSaldos } from '../services/saldo.service.js';

// Instante real de la cita: fecha + hora locales de Lima
const INSTANTE = `(c.fecha + c.hora) AT TIME ZONE 'America/Lima'`;

/**
 * CU-08 Recordar cita (c_enviarRecordatorio): toda reserva queda confirmada al pagar el adelanto, así que
 * el recordatorio es solo un aviso. Citas «Confirmada» que empiezan dentro de las próximas 48 h (y faltan más
 * de 24 h, para que aún pueda cancelar sin perder el adelanto) y no tienen recordatorio → correo con los enlaces
 * para cancelar o reprogramar. Sin correo, la recepcionista lo envía por WhatsApp desde «Citas del día» (P7).
 * (Las «Pendiente de confirmación» de antes del cambio también lo reciben.)
 */
export async function enviarRecordatorios(ahora = new Date()) {
  const ids = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT c.id FROM citas c
      WHERE c.estado IN ('confirmada', 'pendiente_confirmacion') AND c.recordatorio_enviado_en IS NULL
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
        'Recordatorio de su cita — Clínica Dental',
        `<p>Hola ${c.paciente.nombres}:</p>` +
          `<p>Le recordamos su cita del <b>${fechaPE(dateAFecha(c.fecha))} a las ${dateAHora(c.hora)}</b> con ${c.odontologo.usuario.nombres}.</p>` +
          (c.estado === 'pendiente_confirmacion'
            ? `<p><a href="${enlace}">Confirmar o cancelar mi cita</a></p><p>Si no la confirma hasta 24 horas antes, el horario se libera.</p>`
            : `<p>Si no puede asistir, <a href="${enlace}">cancele o reprograme su cita aquí</a> hasta 24 horas antes: su adelanto quedará como saldo a favor.</p>`),
      );
      enviados++;
    }
    await prisma.cita.update({ where: { id }, data: { recordatorioEnviadoEn: ahora } });
  }
  return { revisadas: ids.length, enviados };
}

/**
 * Libera horarios (el horario queda libre):
 *  · RN-04 / CU-08 2.1: citas sin confirmar a menos de 24 h.
 *  · Adelanto no pagado ni reportado dentro de 1 hora (las «Pago en verificación» NO se liberan).
 */
export async function liberarCitas(ahora = new Date()) {
  const filas = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `UPDATE citas c SET estado = 'liberada', updated_at = now()
      WHERE (c.estado = 'pendiente_confirmacion' AND ${INSTANTE} < $1::timestamptz + interval '24 hours')
         OR (c.estado = 'pendiente_adelanto' AND c.adelanto_vence_en < $1::timestamptz)
      RETURNING c.id`,
    ahora.toISOString(),
  );
  return filas.map((f) => f.id).sort((a, b) => a - b);
}

/** Saldo a favor: vencen los abonos sin usar y se avisa por correo 30 y 7 días antes de que venzan. */
export async function revisarSaldos(ahora = new Date()) {
  const vencidos = await vencerSaldos(ahora);
  let avisos = 0;
  for (const dias of [30, 7] as const) {
    for (const a of await porAvisar(dias, ahora)) {
      if (a.paciente.email && a.venceEn && a.restante) {
        await enviarCorreo(
          a.paciente.email,
          'Su saldo a favor está por vencer — Clínica Dental',
          `<p>Hola ${a.paciente.nombres}:</p><p>Tiene <b>S/ ${a.restante.toFixed(2)}</b> de saldo a favor que vence el <b>${fechaPE(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(a.venceEn))}</b>.</p>` +
            `<p>Reserve su próxima cita para usarlo: se descuenta solo del adelanto o del cobro.</p>`,
        ).catch(() => undefined);
        avisos++;
      }
      await prisma.saldoMovimiento.update({ where: { id: a.id }, data: { avisoDias: dias } });
    }
  }
  return { vencidos, avisos };
}
