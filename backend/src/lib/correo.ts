import nodemailer from 'nodemailer';

// En desarrollo, sin SMTP configurado, los correos se escriben en consola (jsonTransport).
const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : nodemailer.createTransport({ jsonTransport: true });
const sinEnvio = nodemailer.createTransport({ jsonTransport: true });

/**
 * Direcciones de prueba (dominio .local, como las de la semilla): no existen, así que no se envían aunque haya SMTP
 * (evita avisos de «correo no entregado» en la cuenta de Gmail de la clínica). Se registran en el log como sin SMTP.
 */
export const esCorreoDePrueba = (para: string) => /\.local$/i.test(para.trim());

export interface Adjunto {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** Solo en pruebas: los correos «enviados», para revisarlos. */
export const bandejaDePrueba: { para: string; asunto: string; html: string }[] = [];

export async function enviarCorreo(para: string, asunto: string, html: string, adjuntos: Adjunto[] = []) {
  if (process.env.NODE_ENV === 'test') bandejaDePrueba.push({ para, asunto, html });
  const prueba = esCorreoDePrueba(para);
  const info = await (prueba ? sinEnvio : transporte).sendMail({ from: process.env.MAIL_FROM, to: para, subject: asunto, html, attachments: adjuntos });
  if ((prueba || !process.env.SMTP_HOST) && process.env.NODE_ENV !== 'test') {
    // El correo no sale: se muestran sus enlaces en el log para poder probar (recuperar contraseña, recordatorio de cita)
    const enlaces = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const motivo = prueba ? 'dirección de prueba .local' : 'SMTP sin configurar';
    console.info(`[correo] (no enviado: ${motivo}) para=${para} asunto="${asunto}"${adjuntos.length ? ` adjuntos=${adjuntos.map((a) => a.filename).join(',')}` : ''}`);
    for (const e of enlaces) console.info(`[correo]   enlace: ${e}`);
  }
  return info;
}
