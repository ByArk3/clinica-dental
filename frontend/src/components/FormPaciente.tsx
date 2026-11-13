import { useEffect, useState, type FormEvent } from 'react';
import { ETIQUETA_SEXO, LARGO_NUMERICO, SEXOS, esMenorDeEdad, limpiarTextoLibre, pacienteSchema, pacienteSinDniSchema, registroPacienteSchema, soloLetras, LIMITE_TEXTO, type Sexo } from '@clinica/shared';
import { ApiError } from '../api/cliente';
import { CampoDigitos, ConfirmarSiNo, Contador, correoValido, FilaResumen } from './Interaccion';
import { DniPaciente } from './DniPaciente';
import { edadDe, fechaPE } from '../formato';
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
  /** Pide «¿Registrar a este paciente?» (Sí / No) con un resumen antes de enviar (registro presencial). */
  confirmar?: boolean;
}

/** Campos solo de números, con su largo máximo */
const NUMERICOS: Record<string, number> = { dni: LARGO_NUMERICO.dni, telefono: LARGO_NUMERICO.celular, apoderadoDni: LARGO_NUMERICO.dni, apoderadoTelefono: LARGO_NUMERICO.celular };
const CELULARES = new Set(['telefono', 'apoderadoTelefono']);
const TEXTO_LIBRE = new Set(['alergias', 'antecedentes']);

const CAMPOS: { nombre: string; etiqueta: string; tipo?: string; col: string; opcional?: boolean }[] = [
  { nombre: 'dni', etiqueta: 'DNI', col: 'col-sm-4' },
  { nombre: 'nombres', etiqueta: 'Nombres', col: 'col-sm-4' },
  { nombre: 'apellidos', etiqueta: 'Apellidos', col: 'col-sm-4' },
  { nombre: 'fechaNacimiento', etiqueta: 'Fecha de nacimiento', tipo: 'date', col: 'col-sm-4' },
  { nombre: 'sexo', etiqueta: 'Sexo', col: 'col-sm-4' },
  { nombre: 'telefono', etiqueta: 'Celular', tipo: 'tel', col: 'col-sm-4' },
  { nombre: 'email', etiqueta: 'Correo', tipo: 'email', col: 'col-sm-4', opcional: true },
  { nombre: 'direccion', etiqueta: 'Dirección', col: 'col-sm-8', opcional: true },
  // Apoderado (P14): solo para menores de 18, y ahí los 3 datos son obligatorios
  { nombre: 'apoderado', etiqueta: 'Nombre del apoderado', col: 'col-sm-6' },
  { nombre: 'apoderadoDni', etiqueta: 'DNI del apoderado', col: 'col-sm-3' },
  { nombre: 'apoderadoTelefono', etiqueta: 'Celular del apoderado', col: 'col-sm-3' },
  { nombre: 'alergias', etiqueta: 'Alergias', col: 'col-sm-6', opcional: true },
  { nombre: 'antecedentes', etiqueta: 'Antecedentes', col: 'col-sm-6', opcional: true },
];

/** CU-03 Registrar paciente (crea también su ficha en el servidor, RN-05). */
export function FormPaciente({ conCuenta, sinDni, dniInicial = '', inicial, textoBoton, onEnviar, onCancelar, confirmar }: Props) {
  const [v, setV] = useState<Valores>({ ...inicial, dni: dniInicial });
  // Si los datos precargados llegan después (RENIEC), solo se completan los campos que siguen vacíos
  useEffect(() => {
    if (inicial) setV((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(inicial).filter(([k]) => !prev[k])) }));
  }, [inicial]);
  const [errores, setErrores] = useState<Valores>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [porConfirmar, setPorConfirmar] = useState<Record<string, unknown> | null>(null);

  const campos = conCuenta
    ? [
        ...CAMPOS.map((c) => (c.nombre === 'email' ? { ...c, opcional: false } : c)),
        { nombre: 'password', etiqueta: 'Contraseña', tipo: 'password', col: 'col-sm-6' },
        { nombre: 'confirmar', etiqueta: 'Confirmar contraseña', tipo: 'password', col: 'col-sm-6' },
      ]
    : sinDni
      ? CAMPOS.filter((c) => c.nombre !== 'dni')
      : CAMPOS;
  // Menor de 18: aparecen los 3 datos del apoderado (obligatorios)
  const menor = esMenorDeEdad(v.fechaNacimiento ?? '');
  const visibles = campos.filter((c) => menor || !c.nombre.startsWith('apoderado'));
  const opcional = (c: { nombre: string; opcional?: boolean }) => !!c.opcional;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // un adulto no lleva apoderado (si se escribió y luego se cambió la fecha, no se envía)
    const datos = menor ? v : { ...v, apoderado: '', apoderadoDni: '', apoderadoTelefono: '' };
    const r = (conCuenta ? registroPacienteSchema : sinDni ? pacienteSinDniSchema : pacienteSchema).safeParse({ ...datos, sexo: v.sexo || undefined });
    const noCoinciden = conCuenta && (v.confirmar ?? '') !== (v.password ?? '');
    if (!r.success || noCoinciden) {
      const c: Valores = {};
      if (!r.success) for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
      if (noCoinciden) c.confirmar = NO_COINCIDEN;
      setErrores(c);
      return;
    }
    setErrores({});
    if (confirmar) return setPorConfirmar(r.data);
    await guardar(r.data);
  }

  async function guardar(datos: Record<string, unknown>) {
    setEnviando(true);
    try {
      await onEnviar(datos);
      setPorConfirmar(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.datos.mensaje);
        setErrores(err.datos.campos ?? {});
      } else setError('No se pudo conectar con el servidor');
      setPorConfirmar(null);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate>
      <p className="small text-muted mb-2"><span className="text-danger">*</span> Campo obligatorio</p>
      <div className="row g-3">
        {visibles.flatMap((c) => [
          ...(c.nombre === 'apoderado' ? [<div className="col-12 small fw-semibold border-top pt-2 mb-n2" key="titulo-apoderado">Es menor de edad: datos del padre, madre o tutor</div>] : []),
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
              <CampoDigitos id={`p-${c.nombre}`} value={v[c.nombre] ?? ''} onChange={(x) => setV({ ...v, [c.nombre]: x })} largo={NUMERICOS[c.nombre]} error={errores[c.nombre]} celular={CELULARES.has(c.nombre)} />
            ) : (
              <input
                id={`p-${c.nombre}`}
                type={c.tipo ?? 'text'}
                {...(c.nombre === 'fechaNacimiento' ? { min: fechaMinimaNacimiento(), max: hoyEnLima() } : {})}
                maxLength={c.nombre === 'direccion' ? LIMITE_TEXTO.direccion : c.nombre === 'apoderado' ? LIMITE_TEXTO.apoderado : TEXTO_LIBRE.has(c.nombre) ? LIMITE_TEXTO.ficha : undefined}
                className={`form-control ${errores[c.nombre] ? 'is-invalid' : ''}`}
                value={v[c.nombre] ?? ''}
                onChange={(e) => {
                  const x = e.target.value;
                  setV({ ...v, [c.nombre]: c.nombre === 'nombres' || c.nombre === 'apellidos' ? soloLetras(x) : c.nombre === 'apoderado' ? soloLetras(x).slice(0, LIMITE_TEXTO.apoderado) : TEXTO_LIBRE.has(c.nombre) ? limpiarTextoLibre(x, LIMITE_TEXTO.ficha) : x });
                  if (c.nombre === 'email' && errores.email && correoValido(x)) setErrores({ ...errores, email: '' });
                }}
                onBlur={c.nombre === 'email' ? (e) => setErrores({ ...errores, email: e.target.value.trim() && !correoValido(e.target.value) ? 'Correo inválido' : '' }) : undefined}
                aria-required={!opcional(c)}
              />
            )}
            {TEXTO_LIBRE.has(c.nombre) && <Contador valor={v[c.nombre] ?? ''} max={LIMITE_TEXTO.ficha} />}
            {c.nombre === 'sexo' && errores.sexo && <div className="text-danger small mt-1">{errores.sexo}</div>}
            {c.nombre !== 'password' && c.nombre !== 'confirmar' && c.nombre !== 'sexo' && !NUMERICOS[c.nombre] && <div className="invalid-feedback">{errores[c.nombre]}</div>}
          </div>,
        ])}
      </div>
      {conCuenta && <p className="small text-muted mt-2 mb-0">Mínimo 8 caracteres.</p>}
      {error && (
        <div className="alert alert-danger mt-3" role="alert">
          {error}
        </div>
      )}
      <ConfirmarSiNo abierto={!!porConfirmar} titulo="¿Registrar a este paciente?" ocupado={enviando} onNo={() => setPorConfirmar(null)} onSi={() => porConfirmar && void guardar(porConfirmar)}>
        {porConfirmar && (
          <>
            <FilaResumen etiqueta="Paciente">{v.nombres} {v.apellidos}</FilaResumen>
            <FilaResumen etiqueta="DNI">{sinDni ? <DniPaciente dni={null} /> : v.dni}</FilaResumen>
            <FilaResumen etiqueta="Nacimiento">{fechaPE(v.fechaNacimiento)} ({edadDe(v.fechaNacimiento)} años)</FilaResumen>
            <FilaResumen etiqueta="Sexo">{ETIQUETA_SEXO[v.sexo as Sexo]}</FilaResumen>
            <FilaResumen etiqueta="Celular">{v.telefono}</FilaResumen>
            {v.email && <FilaResumen etiqueta="Correo">{v.email}</FilaResumen>}
            {menor && <FilaResumen etiqueta="Apoderado">{v.apoderado} · DNI {v.apoderadoDni} · Cel. {v.apoderadoTelefono}</FilaResumen>}
          </>
        )}
      </ConfirmarSiNo>
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
