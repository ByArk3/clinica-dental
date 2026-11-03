// Selector de pieza dental en notación FDI (11–48), dispuesto como la boca vista de frente:
// arriba 18…11 | 21…28, abajo 48…41 | 31…38.
const CUADRANTES: { nombre: string; piezas: string[] }[] = [
  { nombre: 'Superior derecho', piezas: ['18', '17', '16', '15', '14', '13', '12', '11'] },
  { nombre: 'Superior izquierdo', piezas: ['21', '22', '23', '24', '25', '26', '27', '28'] },
  { nombre: 'Inferior derecho', piezas: ['48', '47', '46', '45', '44', '43', '42', '41'] },
  { nombre: 'Inferior izquierdo', piezas: ['31', '32', '33', '34', '35', '36', '37', '38'] },
];

interface Props {
  valor?: string;
  onCambiar: (pieza: string | undefined) => void;
  id?: string;
}

export function PiezaDental({ valor, onCambiar, id }: Props) {
  return (
    <div id={id} className="odontograma" role="group" aria-label="Pieza dental (FDI)">
      {CUADRANTES.map((c) => (
        <div key={c.nombre} className="cuadrante" aria-label={c.nombre} role="group">
          {c.piezas.map((p) => (
            <button
              key={p}
              type="button"
              className={`pieza ${valor === p ? 'activa' : ''}`}
              aria-pressed={valor === p}
              aria-label={`Pieza ${p}`}
              onClick={() => onCambiar(valor === p ? undefined : p)}
            >
              {p}
            </button>
          ))}
        </div>
      ))}
      <div className="small text-muted mt-1">
        {valor ? (
          <>
            Pieza <strong>{valor}</strong>{' '}
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => onCambiar(undefined)}>
              quitar
            </button>
          </>
        ) : (
          'Sin pieza específica (tratamiento general)'
        )}
      </div>
    </div>
  );
}
