import type { Tratamiento } from '../api/recursos';

export interface FilaConsumo {
  insumoId: number;
  nombre: string;
  unidad: string;
  cantidad: number;
  stockActual: number;
  stockMinimo: number;
  resultante: number;
}

/** Suma, por insumo, lo que consumen los tratamientos elegidos (igual que el servidor, CU-11 5.1). */
export function calcularConsumo(tratamientos: (Tratamiento | undefined)[]): FilaConsumo[] {
  const filas = new Map<number, FilaConsumo>();
  for (const t of tratamientos) {
    for (const i of t?.insumos ?? []) {
      const f = filas.get(i.insumoId) ?? {
        insumoId: i.insumoId,
        nombre: i.nombre,
        unidad: i.unidad,
        cantidad: 0,
        stockActual: Number(i.stockActual),
        stockMinimo: Number(i.stockMinimo),
        resultante: 0,
      };
      f.cantidad += Number(i.cantidad);
      filas.set(i.insumoId, f);
    }
  }
  return [...filas.values()]
    .map((f) => ({ ...f, resultante: f.stockActual - f.cantidad }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const num = (n: number) => n.toLocaleString('es-PE', { maximumFractionDigits: 2 });

/** Tabla de los insumos que se descontarán al guardar la atención. */
export function TablaInsumos({ filas }: { filas: FilaConsumo[] }) {
  if (filas.length === 0) return <p className="small text-muted mb-0">Los tratamientos elegidos no consumen insumos.</p>;
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0 small">
        <thead>
          <tr>
            <th>Insumo</th>
            <th className="text-end">Usa</th>
            <th className="text-end">Stock</th>
            <th className="text-end">Queda</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.insumoId} className={f.resultante < 0 ? 'table-danger' : f.resultante <= f.stockMinimo ? 'table-warning' : ''}>
              <td>
                {f.nombre}
                {f.resultante < 0 && <div className="small text-danger">Stock insuficiente: quedará en 0</div>}
                {f.resultante >= 0 && f.resultante <= f.stockMinimo && <div className="small">Quedará en stock mínimo: se generará alerta</div>}
              </td>
              <td className="text-end">{num(f.cantidad)} {f.unidad}</td>
              <td className="text-end">{num(f.stockActual)}</td>
              <td className="text-end fw-semibold">{num(Math.max(0, f.resultante))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
