// Pendiente 32: insumos de la atención. Por defecto, lo que indica el tarifario; el odontólogo puede ajustar
// cantidades (− / +), quitar o agregar insumos y anotar el motivo. Plegado muestra solo un resumen (pendiente 31).
import { useState } from 'react';
import { LIMITE_TEXTO, limpiarDecimal, limpiarTextoLibre } from '@clinica/shared';
import type { InsumoParaAtencion, Tratamiento } from '../api/recursos';
import { calcularConsumo } from './TablaInsumos';

export type AjusteInsumos = { insumoId: number; cantidad: string }[] | null;

const num = (n: number) => n.toLocaleString('es-PE', { maximumFractionDigits: 2 });
const redondear = (n: number) => Math.round(n * 100) / 100;

interface Props {
  tratamientos: (Tratamiento | undefined)[];
  catalogo: InsumoParaAtencion[];
  /** null = lo del tarifario; lista = lo que indicó el odontólogo */
  ajuste: AjusteInsumos;
  onAjuste: (a: AjusteInsumos) => void;
  motivo: string;
  onMotivo: (m: string) => void;
  /** Al editar: lo que ya se descontó (vuelve al stock antes de calcular «Queda») */
  yaDescontado?: Map<number, number>;
  error?: string;
}

/** Lo que se descontará: el ajuste del odontólogo o, si no hay, lo del tarifario. */
export function consumoEfectivo(tratamientos: (Tratamiento | undefined)[], ajuste: AjusteInsumos) {
  if (!ajuste) return calcularConsumo(tratamientos).map((f) => ({ insumoId: f.insumoId, cantidad: f.cantidad }));
  return ajuste.map((x) => ({ insumoId: x.insumoId, cantidad: Number(x.cantidad) || 0 })).filter((x) => x.cantidad > 0);
}

export function InsumosAtencion({ tratamientos, catalogo, ajuste, onAjuste, motivo, onMotivo, yaDescontado, error }: Props) {
  const [abierto, setAbierto] = useState(false);
  const base = calcularConsumo(tratamientos);
  const delTarifario = new Map(base.map((f) => [f.insumoId, f.cantidad]));
  const info = new Map<number, { nombre: string; unidad: string; stock: number; minimo: number }>();
  for (const f of base) info.set(f.insumoId, { nombre: f.nombre, unidad: f.unidad, stock: f.stockActual, minimo: f.stockMinimo });
  for (const c of catalogo) info.set(c.id, { nombre: c.nombre, unidad: c.unidad, stock: Number(c.stockActual), minimo: Number(c.stockMinimo) });

  const filas = (ajuste ?? base.map((f) => ({ insumoId: f.insumoId, cantidad: String(f.cantidad) }))).map((x) => {
    const i = info.get(x.insumoId);
    const stock = (i?.stock ?? 0) + (yaDescontado?.get(x.insumoId) ?? 0);
    const cantidad = Number(x.cantidad) || 0;
    return { ...x, nombre: i?.nombre ?? `Insumo #${x.insumoId}`, unidad: i?.unidad ?? '', stock, minimo: i?.minimo ?? 0, cantidadN: cantidad, queda: stock - cantidad, tarifa: delTarifario.get(x.insumoId) };
  });
  const enMinimo = filas.filter((f) => f.cantidadN > 0 && f.queda >= 0 && f.queda <= f.minimo).length;
  const insuficientes = filas.filter((f) => f.queda < 0).length;
  const usados = filas.filter((f) => f.cantidadN > 0).length;
  const disponibles = catalogo.filter((c) => !filas.some((f) => f.insumoId === c.id));

  /** Cualquier cambio pasa a «ajustado» (parte de lo que se ve) */
  const editar = (cambio: (lista: { insumoId: number; cantidad: string }[]) => { insumoId: number; cantidad: string }[]) =>
    onAjuste(cambio(filas.map((f) => ({ insumoId: f.insumoId, cantidad: f.cantidad }))));
  const paso = (n: number) => (n > 0 && n < 1 ? 0.05 : 1);
  const mover = (id: number, signo: 1 | -1) =>
    editar((l) => l.map((x) => (x.insumoId === id ? { ...x, cantidad: String(Math.max(0, redondear((Number(x.cantidad) || 0) + signo * paso(Number(x.cantidad) || 0)))) } : x)));

  return (
    <div data-testid="insumos-atencion">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>
          Insumos: <strong>{usados}</strong>
          {enMinimo > 0 && <span className="cifra-alerta"> · ⚠ {enMinimo} quedará{enMinimo > 1 ? 'n' : ''} en stock mínimo</span>}
          {insuficientes > 0 && <span className="text-danger fw-semibold"> · {insuficientes} sin stock suficiente</span>}
          {ajuste && <span className="chip chip-atendida ms-2">Ajustados</span>}
        </span>
        <button type="button" className="btn btn-sm btn-outline-secondary" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
          {abierto ? 'Ocultar insumos ▴' : 'Ver y ajustar insumos ▾'}
        </button>
      </div>
      {error && <div className="text-danger small mt-1">{error}</div>}

      {abierto && (
        <div className="mt-2">
          {filas.length === 0 ? (
            <p className="small text-muted mb-2">Los tratamientos elegidos no consumen insumos.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle small mb-2 tabla-insumos-atencion">
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th className="text-center" style={{ width: 132 }}>Usa</th>
                    <th className="text-end" style={{ width: 70 }}>Stock</th>
                    <th className="text-end" style={{ width: 70 }}>Queda</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.insumoId} className={f.queda < 0 ? 'table-danger' : f.cantidadN > 0 && f.queda <= f.minimo ? 'table-warning' : ''}>
                      <td>
                        <div className={f.cantidadN === 0 ? 'text-decoration-line-through text-muted' : ''}>{f.nombre}</div>
                        {f.queda < 0 && <div className="small text-danger">Stock insuficiente: solo hay {num(f.stock)}</div>}
                        {f.cantidadN > 0 && f.queda >= 0 && f.queda <= f.minimo && <div className="small">⚠ Quedará en el mínimo (alerta)</div>}
                        {ajuste && f.tarifa === undefined && <div className="small text-info">Agregado</div>}
                        {ajuste && f.tarifa !== undefined && redondear(f.tarifa) !== f.cantidadN && <div className="small text-info">Ajustado (tarifario: {num(f.tarifa)})</div>}
                      </td>
                      <td>
                        <div className="d-flex align-items-center justify-content-center gap-1">
                          <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-2" aria-label={`Menos ${f.nombre}`} onClick={() => mover(f.insumoId, -1)}>−</button>
                          <input
                            aria-label={`Cantidad de ${f.nombre}`}
                            inputMode="decimal"
                            className="form-control form-control-sm text-center px-1"
                            style={{ width: 56 }}
                            value={f.cantidad}
                            onChange={(e) => editar((l) => l.map((x) => (x.insumoId === f.insumoId ? { ...x, cantidad: limpiarDecimal(e.target.value) } : x)))}
                          />
                          <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-2" aria-label={`Más ${f.nombre}`} onClick={() => mover(f.insumoId, 1)}>+</button>
                        </div>
                        <div className="text-center text-muted" style={{ fontSize: '0.75rem' }}>{f.unidad}</div>
                      </td>
                      <td className="text-end">{num(f.stock)}</td>
                      <td className={`text-end fw-semibold ${f.cantidadN > 0 && f.queda <= f.minimo ? 'cifra-alerta' : ''}`}>{num(Math.max(0, f.queda))}</td>
                      <td className="text-end">
                        <button type="button" className="btn btn-sm btn-outline-danger py-0" aria-label={`Quitar ${f.nombre}`} title="Quitar insumo" onClick={() => editar((l) => l.filter((x) => x.insumoId !== f.insumoId))}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <select
              aria-label="Agregar insumo"
              className="form-select form-select-sm"
              style={{ maxWidth: 280 }}
              value=""
              onChange={(e) => e.target.value && editar((l) => [...l, { insumoId: Number(e.target.value), cantidad: '1' }])}
            >
              <option value="">+ Agregar insumo…</option>
              {disponibles.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.unidad})</option>)}
            </select>
            {ajuste && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { onAjuste(null); onMotivo(''); }}>
                Volver a lo del tarifario
              </button>
            )}
          </div>
          {ajuste && (
            <div className="mt-2">
              <label htmlFor="motivo-insumos" className="form-label small mb-1">Motivo del ajuste <small className="text-muted">(opcional)</small></label>
              <input
                id="motivo-insumos"
                className="form-control form-control-sm"
                maxLength={300}
                placeholder="Ej.: se necesitó más resina por el tamaño de la lesión"
                value={motivo}
                onChange={(e) => onMotivo(limpiarTextoLibre(e.target.value, LIMITE_TEXTO.motivo))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
