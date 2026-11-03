// PDF del comprobante (pdfkit, generado en el servidor). P2: comprobante INTERNO, no tributario.
import PDFDocument from 'pdfkit';
import type { ComprobanteCompleto } from '../services/caja.service.js';

const soles = (n: { toFixed: (d: number) => string } | string) =>
  `S/ ${Number(typeof n === 'string' ? n : n.toFixed(2)).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fechaHora = (d: Date) =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

export function pdfComprobante(c: ComprobanteCompleto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Tamaño de ticket ancho (A5) para impresoras comunes
    const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `Comprobante ${c.numero}`, Author: 'Clínica Dental' } });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const ancho = doc.page.width - 72;
    const izq = 36;
    const fila = (a: string, b: string, negrita = false) => {
      const y = doc.y;
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrita ? 11 : 10);
      doc.text(a, izq, y, { width: ancho - 90 });
      const yFin = doc.y;
      doc.text(b, izq + ancho - 90, y, { width: 90, align: 'right' });
      doc.y = Math.max(yFin, doc.y);
    };
    const linea = () => {
      doc.moveDown(0.4);
      doc.moveTo(izq, doc.y).lineTo(izq + ancho, doc.y).strokeColor('#0E7C86').lineWidth(0.8).stroke();
      doc.moveDown(0.4);
    };

    doc.fillColor('#0B3C49').font('Helvetica-Bold').fontSize(16).text('Clínica Dental', { align: 'center' });
    doc.fillColor('#555').font('Helvetica').fontSize(9).text('Trujillo — Perú', { align: 'center' });
    doc.moveDown(0.6);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text(`COMPROBANTE ${c.tipo === 'adelanto' ? 'DE ADELANTO ' : ''}N.° ${c.numero}`, { align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#777').text('Comprobante interno — no es boleta ni factura electrónica', { align: 'center' });
    doc.fillColor('#000');
    linea();

    doc.fontSize(10).font('Helvetica');
    doc.x = izq;
    doc.text(`Fecha: ${fechaHora(c.createdAt)}`);
    doc.text(`Paciente: ${c.paciente.nombres} ${c.paciente.apellidos}`);
    doc.text(`DNI: ${c.paciente.dni}`);
    doc.text(`Cita N.° ${c.citaId}`);
    linea();

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#555');
    fila('Descripción', 'Importe');
    doc.fillColor('#000');
    for (const d of c.detalles) fila(d.descripcion, soles(d.precio));
    linea();

    fila('Subtotal', soles(c.subtotal));
    if (c.descuento.greaterThan(0)) fila(`Descuento${c.descuentoAplicado ? ` (${c.descuentoAplicado.nombre} ${Number(c.descuentoAplicado.porcentaje)} %)` : ''}`, `- ${soles(c.descuento)}`);
    if (c.adelantoAplicado.greaterThan(0)) fila('Adelanto pagado', `- ${soles(c.adelantoAplicado)}`);
    doc.moveDown(0.2);
    fila('TOTAL', soles(c.total), true);
    linea();

    fila(`Forma de pago: ${c.tipoPago.nombre}`, '');
    if (c.tipoPago.nombre.toLowerCase() === 'efectivo') {
      fila('Recibido', soles(c.montoRecibido));
      fila('Vuelto', soles(c.vuelto));
    }
    doc.moveDown(1);
    // x y ancho explícitos: `fila` deja el cursor en la columna derecha
    doc.font('Helvetica').fontSize(8).fillColor('#777');
    doc.text(`Atendido por: ${c.emitidoPor.nombres}`, izq, doc.y, { width: ancho, align: 'center' });
    doc.text('Gracias por su preferencia', izq, doc.y, { width: ancho, align: 'center' });
    doc.end();
  });
}
