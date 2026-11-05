// Datos de pago del adelanto: número y titular de Yape/Plin, billeteras aceptadas y QR. Los configura el Administrador.
import { BILLETERAS, MENSAJES, MESES_VIGENCIA_SALDO, nombreBilleteras, type Billetera, type ConfigPagoDTO } from '@clinica/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { ErrorNegocio } from '../lib/errores.js';

const CLAVES = ['pago_numero', 'pago_titular', 'pago_billeteras', 'saldo_vigencia_meses'] as const;
/** Nombres posibles del tipo de pago de billetera digital en caja (se renombra según las billeteras aceptadas). */
const NOMBRES_BILLETERA = ['Yape', 'Plin', 'Yape/Plin'];

const leerBilleteras = (valor: string | undefined): Billetera[] => {
  const b = (valor ?? 'yape').split(',').filter((x): x is Billetera => (BILLETERAS as readonly string[]).includes(x));
  return b.length ? b : ['yape'];
};

/** Lo que ve el paciente (y la recepcionista) para pagar el adelanto. */
export async function datosPago(db: Tx | typeof prisma = prisma) {
  const filas = await db.configuracion.findMany({ where: { clave: { in: [...CLAVES, 'pago_qr'] } }, select: { clave: true, valor: true } });
  const v = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    numero: v.pago_numero ?? null,
    titular: v.pago_titular ?? null,
    billeteras: leerBilleteras(v.pago_billeteras),
    tieneQr: !!v.pago_qr,
    saldoVigenciaMeses: v.saldo_vigencia_meses !== undefined ? Number(v.saldo_vigencia_meses) : MESES_VIGENCIA_SALDO,
  };
}

export const billeterasAceptadas = async (db: Tx | typeof prisma = prisma) => (await datosPago(db)).billeteras;

/** Tipo de pago de caja que corresponde a la billetera digital (Yape, Plin o Yape/Plin). */
export const tipoPagoBilletera = (db: Tx | typeof prisma = prisma) => db.tipoPago.findFirst({ where: { nombre: { in: NOMBRES_BILLETERA } } });

/** Guarda número, titular y billeteras; el tipo de pago de caja toma el nombre de las billeteras aceptadas. */
export async function guardarDatosPago(d: ConfigPagoDTO) {
  await prisma.$transaction(async (tx) => {
    const valores: [string, string][] = [
      ['pago_numero', d.numero],
      ['pago_titular', d.titular],
      ['pago_billeteras', BILLETERAS.filter((b) => d.billeteras.includes(b)).join(',')],
      ['saldo_vigencia_meses', String(d.saldoVigenciaMeses)],
    ];
    for (const [clave, valor] of valores) await tx.configuracion.upsert({ where: { clave }, update: { valor }, create: { clave, valor } });
    const tipo = await tipoPagoBilletera(tx);
    const nombre = nombreBilleteras(d.billeteras);
    if (tipo) await tx.tipoPago.update({ where: { id: tipo.id }, data: { nombre } });
    else await tx.tipoPago.create({ data: { nombre } });
  });
  return datosPago();
}

/** QR de la clínica (imagen como data URL guardada en la configuración). */
export async function guardarQr(dataUrl: string) {
  await prisma.configuracion.upsert({ where: { clave: 'pago_qr' }, update: { valor: dataUrl }, create: { clave: 'pago_qr', valor: dataUrl } });
  return datosPago();
}
export async function quitarQr() {
  await prisma.configuracion.deleteMany({ where: { clave: 'pago_qr' } });
  return datosPago();
}
export async function qr() {
  const f = await prisma.configuracion.findUnique({ where: { clave: 'pago_qr' } });
  if (!f) throw new ErrorNegocio(404, 'SIN_QR', MENSAJES.SIN_QR);
  const coma = f.valor.indexOf(',');
  return { tipo: f.valor.slice(5, f.valor.indexOf(';')), datos: Buffer.from(f.valor.slice(coma + 1), 'base64') };
}
