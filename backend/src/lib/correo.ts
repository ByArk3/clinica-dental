import nodemailer from 'nodemailer';

// En desarrollo, sin SMTP configurado, los correos se escriben en consola (jsonTransport).
const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : nodemailer.createTransport({ jsonTransport: true });

export async function enviarCorreo(para: string, asunto: string, html: string) {
  const info = await transporte.sendMail({ from: process.env.MAIL_FROM, to: para, subject: asunto, html });
  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== 'test') {
    console.info(`[correo] para=${para} asunto="${asunto}"`);
  }
  return info;
}
