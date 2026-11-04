import { useState } from 'react';

interface Props {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  autoComplete?: string;
  error?: string;
  required?: boolean;
}

/** Campo de contraseña con botón para mostrarla u ocultarla. */
export function CampoPassword({ id, value, onChange, autoComplete, error, required }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-group has-validation">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className={`form-control ${error ? 'is-invalid' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        autoCapitalize="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="btn btn-outline-secondary"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        aria-controls={id}
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
      {error && <div className="invalid-feedback">{error}</div>}
    </div>
  );
}
