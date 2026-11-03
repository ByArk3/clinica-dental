/** Error de negocio: el manejador lo traduce a { codigo, mensaje } con su status HTTP. */
export class ErrorNegocio extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensaje: string,
    public campos?: Record<string, string>,
  ) {
    super(mensaje);
  }
}
