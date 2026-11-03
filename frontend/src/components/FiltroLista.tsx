interface Props {
  q: string;
  onQ: (q: string) => void;
  estado: string;
  onEstado: (e: string) => void;
  extra?: React.ReactNode;
}

/** Búsqueda + filtro por estado, común a los listados CRUD (patrón Listar del brief). */
export function FiltroLista({ q, onQ, estado, onEstado, extra }: Props) {
  return (
    <div className="d-flex flex-wrap gap-2 mb-3">
      <input className="form-control" style={{ maxWidth: 280 }} placeholder="Buscar por nombre" aria-label="Buscar" value={q} onChange={(e) => onQ(e.target.value)} />
      <select className="form-select" style={{ maxWidth: 160 }} aria-label="Estado" value={estado} onChange={(e) => onEstado(e.target.value)}>
        <option value="1">Activos</option>
        <option value="0">Desactivados</option>
        <option value="">Todos</option>
      </select>
      {extra}
    </div>
  );
}
