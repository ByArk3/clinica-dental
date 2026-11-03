// PDF del pedido al proveedor (CU-30 paso 4). P13: sin precios, solo cantidades.
import PDFDocument from 'pdfkit';
import type { PedidoCompleto } from '../services/pedido.service.js';

export function pdfPedido(p: PedidoCompleto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Pedido ${p.codigo}`, Author: 'Clínica Dental' } });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const izq = 50;
    const ancho = doc.page.width - 100;
    const fecha = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(p.createdAt);

    doc.fillColor('#0B3C49').font('Helvetica-Bold').fontSize(18).text('Clínica Dental', izq, 50);
    doc.fillColor('#555').font('Helvetica').fontSize(10).text('Trujillo — Perú');
    doc.moveDown();
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(`PEDIDO DE INSUMOS ${p.codigo}`);
    doc.font('Helvetica').fontSize(10).text(`Fecha: ${fecha}`);
    doc.moveDown(0.5);
    doc.text(`Proveedor: ${p.proveedor.razonSocial}`);
    doc.text(`RUC: ${p.proveedor.ruc}`);
    if (p.proveedor.contacto) doc.text(`Contacto: ${p.proveedor.contacto}`);
    doc.moveDown();

    const col = [izq, izq + 30, izq + ancho - 150, izq + ancho - 70];
    const y0 = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('N.°', col[0], y0).text('Insumo', col[1], y0).text('Unidad', col[2], y0).text('Cantidad', col[3], y0, { width: 70, align: 'right' });
    doc.moveTo(izq, doc.y + 3).lineTo(izq + ancho, doc.y + 3).strokeColor('#0E7C86').stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica');
    p.detalles.forEach((d, i) => {
      const y = doc.y;
      doc.text(String(i + 1), col[0], y);
      doc.text(d.insumo.nombre, col[1], y, { width: col[2] - col[1] - 10 });
      const yFin = doc.y;
      doc.text(d.insumo.unidad, col[2], y);
      doc.text(Number(d.cantidadPedida).toLocaleString('es-PE', { maximumFractionDigits: 2 }), col[3], y, { width: 70, align: 'right' });
      doc.y = Math.max(yFin, doc.y) + 4;
    });
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#555').text(`Solicitado por: ${p.registradoPor.nombres}`, izq, doc.y, { width: ancho });
    doc.text('Por favor, confirme la disponibilidad y la fecha de entrega.', izq, doc.y, { width: ancho });
    doc.end();
  });
}
