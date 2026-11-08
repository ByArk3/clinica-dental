import { useEffect, useState, type FormEvent } from 'react';
import { ETIQUETA_SEXO, LARGO_NUMERICO, SEXOS, esMenorDeEdad, pacienteSchema, pacienteSinDniSchema, registroPacienteSchema, soloLetras } from '@clinica/shared';
import { ApiError } from '../api/cliente';
import { CampoDigitos } from './Interaccion';
import { CampoPassword, ConfirmarPassword, NO_COINCIDEN } from './CampoPassword';
import { fechaMinimaNacimiento, hoyEnLima } from '@clinica/shared';

type Valores = Record<string, string>;

interface Props {
  /** true = registro web (pide correo y contraseña para crear la cuenta) */
  conCuenta?: boolean;
  /** true = registro presencial sin DNI a la mano (queda «DNI pendiente»; el sexo es obligatorio) */
  sinDni?: boolean;
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
  { nombre: 'sexo', etiqueta: 'Sexo', col: 'col-sm-4' },
  { nombre: 'telefono', etiqueta: 'Celular', tipo: 'tel', col: 'col-sm-4' },
  { nombre: 'email', etiqueta: 'Correo', tipo: 'email', col: 'col-sm-4', opcional: true },
  { nombre: 'direccion', etiqueta: 'Dirección', col: 'col-sm-8', opcional: true },
  { nombre: 'apoderado', etiqueta: 'Apoderado', col: 'col-sm-4', opcional: true },
  { nombre: 'alergias', etiqueta: 'Alergias', col: 'col-sm-6', opcional: true },
  { nombre: 'antecedentes', etiqueta: 'Antecedentes', col: 'col-sm-6', opcional: true },
];

/** CU-03 Registrar paciente (crea también su ficha en el servidor, RN-05). */
export function FormPaciente({ conCuenta, sinDni, dniInicial = '', inicial, textoBoton, onEnviar, onCancelar }: Props) {
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
        { nombre: 'confirmar', etiqueta: 'Confirmar contraseña', tipo: 'password', col: 'col-sm-6' },
      ]
    : sinDni
      ? CAMPOS.filter((c) => c.nombre !== 'dni')
      : CAMPOS;
  // Menor de 18: el apoderado pasa a ser obligatorio
  const menor = esMenorDeEdad(v.fechaNacimiento ?? '');
  const opcional = (c: { nombre: string; opcional?: boolean }) => (c.nombre === 'apoderado' ? !menor : !!c.opcional);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = (conCuenta ? registroPacienteSchema : sinDni ? pacienteSinDniSchema : pacienteSchema).safeParse({ ...v, sexo: v.sexo || undefined });
    const noCoinciden = conCuenta && (v.confirmar ?? '') !== (v.password ?? '');
    if (!r.success || noCoinciden) {
      const c: Valores = {};
      if (!r.success) for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
      if (noCoinciden) c.confirmar = NO_COINCIDEN;
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
      <p className="small text-muted mb-2"><span className="text-danger">*</span> Campo obligatorio</p>
      <div className="row g-3">
        {campos.map((c) => (
          <div className={c.col} key={c.nombre}>
            <label htmlFor={`p-${c.nombre}`} className={`form-label ${opcional(c) ? '' : 'obligatorio'}`}>
              {c.etiqueta} {opcional(c) && <small className="text-muted">(opcional)</small>}
            </label>
            {c.nombre === 'confirmar' ? (
              <ConfirmarPassword id="p-confirmar" password={v.password ?? ''} value={v.confirmar ?? ''} onChange={(x) => setV({ ...v, confirmar: x })} error={errores.confirmar} />
            ) : c.nombre === 'password' ? (
              <CampoPassword
                id="p-password"
                value={v.password ?? ''}
                onChange={(x) => setV({ ...v, password: x })}
                autoComplete="new-password"
                error={errores.password}
              />
            ) : c.nombre === 'sexo' ? (
              <div role="group" aria-label="Sexo" className="d-flex gap-2">
                {SEXOS.map((x) => (
                  <button key={x} type="button" className={`btn ${v.sexo === x ? 'btn-acento' : 'btn-outline-secondary'} ${errores.sexo ? 'border-danger' : ''}`} aria-pressed={v.sexo === x} onClick={() => setV({ ...v, sexo: v.sexo === x ? '' : x })}>
                    {ETIQUETA_SEXO[x]}
                  </button>
                ))}
              </div>
            ) : NUMERICOS[c.nombre] ? (
              <CampoDigitos id={`p-${c.nombre}`} value={v[c.nombre] ?? ''} onChange={(x) => setV({ ...v, [c.nombre]: x })} largo={NUMERICOS[c.nombre]} error={errores[c.nombre]} />
            ) : (
              <input
                id={`p-${c.nombre}`}
                type={c.tipo ?? 'text'}
                {...(c.nombre === 'fechaNacimiento' ? { min: fechaMinimaNacimiento(), max: hoyEnLima() } : {})}
                className={`form-control ${errores[c.nombre] ? 'is-invalid' : ''}`}
                value={v[c.nombre] ?? ''}
                onChange={(e) => setV({ ...v, [c.nombre]: c.nombre === 'nombres' || c.nombre === 'apellidos' ? soloLetras(e.target.value) : e.target.value })}
                aria-required={!opcional(c)}
              />
            )}
            {c.nombre === 'apoderado' && menor && <div className="form-text">Es menor de edad: nombre, DNI y celular del padre, madre o tutor.</div>}
            {c.nombre === 'sexo' && errores.sexo && <div className="text-danger small mt-1">{errores.sexo}</div>}
            {c.nombre !== 'password' && c.nombre !== 'confirmar' && c.nombre !== 'sexo' && !NUMERICOS[c.nombre] && <div className="invalid-feedback">{errores[c.nombre]}</div>}
          </div>
        ))}
      </div>
      {conCuenta && <p className="small text-muted mt-2 mb-0">Mínimo 8 caracteres.</p>}
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
