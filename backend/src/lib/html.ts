/**
 * Escapa texto escrito por usuarios (nombres, motivos…) antes de insertarlo en el HTML de un correo:
 * «<b>Ana</b>» se muestra tal cual y no se interpreta como HTML.
 */
export function escaparHtml(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
