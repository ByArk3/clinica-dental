import nodemailer from 'nodemailer';

// En desarrollo, sin SMTP configurado, los correos se escriben en consola (jsonTransport).
const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : nodemailer.createTransport({ jsonTransport: true });

export interface Adjunto {
  filename: string;
  content: Buffer;
  contentType: string;
}

export async function enviarCorreo(para: string, asunto: string, html: string, adjuntos: Adjunto[] = []) {
  const info = await transporte.sendMail({ from: process.env.MAIL_FROM, to: para, subject: asunto, html, attachments: adjuntos });
  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== 'test') {
    // Sin SMTP el correo no sale: se muestran sus enlaces en el log para poder probar (recuperar contraseña, confirmar cita)
    const enlaces = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.info(`[correo] (no enviado: SMTP sin configurar) para=${para} asunto="${asunto}"${adjuntos.length ? ` adjuntos=${adjuntos.map((a) => a.filename).join(',')}` : ''}`);
    for (const e of enlaces) console.info(`[correo]   enlace: ${e}`);
  }
  return info;
}
