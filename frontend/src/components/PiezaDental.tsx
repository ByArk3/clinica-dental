// Selector de pieza dental en notación FDI, dispuesto como la boca vista de frente (la derecha del paciente queda
// a la izquierda de la pantalla): arriba 18…11 | 21…28, abajo 48…41 | 31…38. Dientes de leche: 55…51 | 61…65 y
// 85…81 | 71…75 (se muestran primero si el paciente tiene menos de 12 años).
import { useState } from 'react';
import { EDAD_DIENTES_DE_LECHE, nombrePieza } from '@clinica/shared';

const fila = (c: number, n: number, haciaElCentro: boolean) => {
  const piezas = Array.from({ length: n }, (_, i) => `${c}${i + 1}`);
  return haciaElCentro ? piezas.reverse() : piezas;
};
const BOCA = {
  permanente: [
    { nombre: 'Arriba · derecha del paciente', piezas: fila(1, 8, true) },
    { nombre: 'Arriba · izquierda', piezas: fila(2, 8, false) },
    { nombre: 'Abajo · derecha', piezas: fila(4, 8, true) },
    { nombre: 'Abajo · izquierda', piezas: fila(3, 8, false) },
  ],
  leche: [
    { nombre: 'Arriba · derecha del paciente', piezas: fila(5, 5, true) },
    { nombre: 'Arriba · izquierda', piezas: fila(6, 5, false) },
    { nombre: 'Abajo · derecha', piezas: fila(8, 5, true) },
    { nombre: 'Abajo · izquierda', piezas: fila(7, 5, false) },
  ],
};

interface Props {
  valor?: string;
  onCambiar: (pieza: string | undefined) => void;
  id?: string;
  /** Edad del paciente: con menos de 12 años se muestran primero los dientes de leche */
  edad?: number | null;
}

export function PiezaDental({ valor, onCambiar, id, edad }: Props) {
  const [denticion, setDenticion] = useState<'permanente' | 'leche'>(() =>
    valor ? (Number(valor[0]) >= 5 ? 'leche' : 'permanente') : edad != null && edad < EDAD_DIENTES_DE_LECHE ? 'leche' : 'permanente',
  );
  return (
    <div id={id}>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">
        <span className="small">
          Pieza dental <span className="text-muted">(opcional)</span>
        </span>
        <button type="button" className="btn btn-sm btn-outline-secondary py-0" onClick={() => setDenticion(denticion === 'leche' ? 'permanente' : 'leche')}>
          {denticion === 'leche' ? 'Ver dientes de adulto' : 'Ver dientes de leche'}
        </button>
      </div>
      <div className={`odontograma ${denticion === 'leche' ? 'de-leche' : ''}`} role="group" aria-label={`Pieza dental (FDI, ${denticion === 'leche' ? 'dientes de leche' : 'dientes de adulto'})`}>
        {BOCA[denticion].map((c) => (
          <div key={c.nombre} className="bloque-cuadrante">
            <div className="titulo-cuadrante">{c.nombre}</div>
            <div className="cuadrante" aria-label={c.nombre} role="group">
              {c.piezas.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pieza ${valor === p ? 'activa' : ''}`}
                  aria-pressed={valor === p}
                  aria-label={`Pieza ${p}`}
                  title={`${p} · ${nombrePieza(p)}`}
                  onClick={() => onCambiar(valor === p ? undefined : p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="d-flex flex-wrap align-items-center gap-2 small mt-1">
        {valor ? (
          <>
            <span>
              <strong>Pieza {valor}</strong> — {nombrePieza(valor)}
            </span>
            <button type="button" className="btn btn-sm btn-outline-secondary py-0" onClick={() => onCambiar(undefined)}>
              ✕ Quitar pieza
            </button>
          </>
        ) : (
          <span className="text-muted">Sin pieza específica (tratamiento general)</span>
        )}
      </div>
      <div className="form-text mt-0">Numeración FDI: el primer dígito es la zona de la boca y el segundo, el diente contando desde el centro.</div>
    </div>
  );
}

/** «36» → «pieza 36 · primer molar inferior izquierdo», para Caja, el comprobante y el historial. */
export const textoPieza = (p: string | null | undefined) => (p ? `pieza ${p} · ${nombrePieza(p)}` : '');
