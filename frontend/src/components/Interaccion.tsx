// Piezas de interacción reutilizables: botón que trabaja, copiar con un toque y campo de solo dígitos con ✓/✗.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { soloDigitos } from '@clinica/shared';

interface MutacionMinima {
  isPending: boolean;
  isSuccess: boolean;
  submittedAt: number;
}

/**
 * Botón que «trabaja»: mientras se guarda muestra un circulito girando (y no deja hacer doble clic);
 * al terminar se pone verde con ✓ un momento.
 */
export function BotonAccion({
  mutacion,
  children,
  textoPendiente = 'Guardando…',
  className = 'btn btn-acento',
  disabled,
  ...resto
}: { mutacion: MutacionMinima; children: ReactNode; textoPendiente?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [listo, setListo] = useState(false);
  useEffect(() => {
    if (!mutacion.isSuccess) return;
    setListo(true);
    const t = setTimeout(() => setListo(false), 1200);
    return () => clearTimeout(t);
  }, [mutacion.isSuccess, mutacion.submittedAt]);
  return (
    <button className={`${className} ${listo ? 'listo' : ''}`} disabled={disabled || mutacion.isPending} aria-busy={mutacion.isPending} {...resto}>
      {mutacion.isPending ? (
        <>
          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
          {textoPendiente}
        </>
      ) : listo ? (
        <>✓ Listo</>
      ) : (
        children
      )}
    </button>
  );
}

/** Copiar un texto con un toque (número de Yape, N.° de operación…). */
export function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(t.current), []);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      clearTimeout(t.current);
      t.current = setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sin portapapeles (http o permiso denegado): no pasa nada */
    }
  }
  return (
    <button type="button" className="btn btn-link btn-sm p-0 ms-1 align-baseline text-decoration-none" onClick={copiar} aria-label={`Copiar ${etiqueta}`} title={`Copiar ${etiqueta}`}>
      {copiado ? <span className="text-success small">¡Copiado!</span> : '📋'}
    </button>
  );
}

/**
 * Campo de solo dígitos con largo fijo: no deja escribir otra cosa; ✓ verde al completarlo y ✗ rojo
 * (con cuántos faltan) si se deja incompleto. `error` (del formulario o la API) tiene prioridad.
 */
export function CampoDigitos({
  id,
  value,
  onChange,
  largo,
  error,
  className = '',
  placeholder,
  style,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  largo: number;
  error?: string;
  className?: string;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [tocado, setTocado] = useState(false);
  const completo = value.length === largo;
  const incompleto = tocado && value.length > 0 && !completo;
  const estado = error || incompleto ? 'is-invalid' : completo ? 'is-valid' : '';
  return (
    <>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        maxLength={largo}
        className={`form-control ${estado} ${className}`}
        style={style}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(soloDigitos(e.target.value, largo))}
        onBlur={() => setTocado(true)}
      />
      <div className="invalid-feedback">{error ?? (incompleto ? `Faltan ${largo - value.length} dígito(s) (son ${largo})` : '')}</div>
    </>
  );
}

/**
 * Aviso flotante abajo al centro (p. ej. «Se quitaron 4 insumos · Deshacer»). Se cierra solo a los
 * `duracion` ms; la línea inferior muestra el tiempo que queda.
 */
export function AvisoFlotante({
  children,
  accion,
  onCerrar,
  duracion = 8000,
  icono,
}: {
  children: ReactNode;
  accion?: { texto: string; onClick: () => void };
  onCerrar: () => void;
  duracion?: number;
  icono?: ReactNode;
}) {
  useEffect(() => {
    const t = setTimeout(onCerrar, duracion);
    return () => clearTimeout(t);
  }, [onCerrar, duracion]);
  // Portal al <body>: la animación de entrada de cada pantalla crea su propio contexto y «fixed» quedaría dentro de ella
  return createPortal(
    <div className="aviso-flotante" role="status">
      <div className="cuerpo">
        {icono && <span className="ico" aria-hidden="true">{icono}</span>}
        <span>{children}</span>
        {accion && (
          <button type="button" className="accion" onClick={accion.onClick}>
            {accion.texto}
          </button>
        )}
        <button type="button" className="cerrar" aria-label="Cerrar aviso" onClick={onCerrar}>
          ×
        </button>
      </div>
      <div className="barra" style={{ animationDuration: `${duracion}ms` }} />
    </div>,
    document.body,
  );
}

export const IconoPapelera = ({ tam = 15 }: { tam?: number }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

/** Contador de caracteres para textos largos («120/500»); se pone en rojo al llegar al límite. */
export function Contador({ valor, max }: { valor: string; max: number }) {
  return (
    <div className={`form-text text-end ${valor.length >= max ? 'text-danger' : ''}`} aria-live="polite">
      {valor.length}/{max}
    </div>
  );
}
