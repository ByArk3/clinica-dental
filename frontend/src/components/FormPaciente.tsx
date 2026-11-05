import { useEffect, useState, type FormEvent } from 'react';
import { LARGO_NUMERICO, pacienteSchema, registroPacienteSchema } from '@clinica/shared';
import { ApiError } from '../api/cliente';
import { CampoDigitos } from './Interaccion';
import { CampoPassword } from './CampoPassword';

type Valores = Record<string, string>;

interface Props {
  /** true = registro web (pide correo y contraseña para crear la cuenta) */
  conCuenta?: boolean;
  dniInicial?: string;
  /** Valores precargados (p. ej. nombres y apellidos obtenidos de RENIEC) */
  inicial?: Valores;
  textoBoton: string;
  onEnviar: (datos: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  onCancelar?: () => void;
}

/** Campos solo de números, con su largo máximo */
const NUMERICOS: Record<string, number> = { dni: LARGO_NUMERICO.dni, telefono: LARGO_NUMERICO.celular };

const CAMPOS: { nombre: string; etiqueta: string; tipo?: string; col: string; opcional?: boolean }[] = [
  { nombre: 'dni', etiqueta: 'DNI', col: 'col-sm-4' },
  { nombre: 'nombres', etiqueta: 'Nombres', col: 'col-sm-4' },
  { nombre: 'apellidos', etiqueta: 'Apellidos', col: 'col-sm-4' },
  { nombre: 'fechaNacimiento', etiqueta: 'Fecha de nacimiento', tipo: 'date', col: 'col-sm-4' },
  { nombre: 'telefono', etiqueta: 'Celular', tipo: 'tel', col: 'col-sm-4' },
  { nombre: 'email', etiqueta: 'Correo', tipo: 'email', col: 'col-sm-4', opcional: true },
  { nombre: 'direccion', etiqueta: 'Dirección', col: 'col-sm-8', opcional: true },
  { nombre: 'apoderado', etiqueta: 'Apoderado (menores)', col: 'col-sm-4', opcional: true },
  { nombre: 'alergias', etiqueta: 'Alergias', col: 'col-sm-6', opcional: true },
  { nombre: 'antecedentes', etiqueta: 'Antecedentes', col: 'col-sm-6', opcional: true },
];

/** CU-03 Registrar paciente (crea también su ficha en el servidor, RN-05). */
export function FormPaciente({ conCuenta, dniInicial = '', inicial, textoBoton, onEnviar, onCancelar }: Props) {
  const [v, setV] = useState<Valores>({ ...inicial, dni: dniInicial });
  // Si los datos precargados llegan después (RENIEC), solo se completan los campos que siguen vacíos
  useEffect(() => {
    if (inicial) setV((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(inicial).filter(([k]) => !prev[k])) }));
  }, [inicial]);
  const [errores, setErrores] = useState<Valores>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const campos = conCuenta
    ? [
        ...CAMPOS.map((c) => (c.nombre === 'email' ? { ...c, opcional: false } : c)),
        { nombre: 'password', etiqueta: 'Contraseña', tipo: 'password', col: 'col-sm-6' },
      ]
    : CAMPOS;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = (conCuenta ? registroPacienteSchema : pacienteSchema).safeParse(v);
    if (!r.success) {
      const c: Valores = {};
      for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
      setErrores(c);
      return;
    }
    setErrores({});
    setEnviando(true);
    try {
      await onEnviar(r.data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.datos.mensaje);
        setErrores(err.datos.campos ?? {});
      } else setError('No se pudo conectar con el servidor');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate>
      <div className="row g-3">
        {campos.map((c) => (
          <div className={c.col} key={c.nombre}>
            <label htmlFor={`p-${c.nombre}`} className="form-label">
              {c.etiqueta} {c.opcional && <small className="text-muted">(opcional)</small>}
            </label>
            {c.nombre === 'password' ? (
              <CampoPassword
                id="p-password"
                value={v.password ?? ''}
                onChange={(x) => setV({ ...v, password: x })}
                autoComplete="new-password"
                error={errores.password}
              />
            ) : NUMERICOS[c.nombre] ? (
              <CampoDigitos id={`p-${c.nombre}`} value={v[c.nombre] ?? ''} onChange={(x) => setV({ ...v, [c.nombre]: x })} largo={NUMERICOS[c.nombre]} error={errores[c.nombre]} />
            ) : (
              <input
                id={`p-${c.nombre}`}
                type={c.tipo ?? 'text'}
                className={`form-control ${errores[c.nombre] ? 'is-invalid' : ''}`}
                value={v[c.nombre] ?? ''}
                onChange={(e) => setV({ ...v, [c.nombre]: e.target.value })}
              />
            )}
            {c.nombre !== 'password' && !NUMERICOS[c.nombre] && <div className="invalid-feedback">{errores[c.nombre]}</div>}
          </div>
        ))}
      </div>
      {conCuenta && <p className="small text-muted mt-2 mb-0">Mínimo 8 caracteres, con letras y números.</p>}
      {error && (
        <div className="alert alert-danger mt-3" role="alert">
          {error}
        </div>
      )}
      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-acento" disabled={enviando}>
          {enviando ? 'Guardando…' : textoBoton}
        </button>
        {onCancelar && (
          <button type="button" className="btn btn-outline-secondary" onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
