import { useCallback, useState, type FormEvent } from 'react';
import { contactoSchema, esMenorDeEdad, type ContactoDTO, LARGO_NUMERICO, LIMITE_TEXTO, soloLetras } from '@clinica/shared';
import type { Paciente } from '../api/recursos';
import { AvisoFlotante, CampoDigitos, ConfirmarSiNo, correoValido, FilaResumen } from './Interaccion';
import { camposApi, mensajeError } from '../formato';

type Campo = 'telefono' | 'email' | 'direccion' | 'apoderado' | 'apoderadoDni' | 'apoderadoTelefono';
const ETIQUETAS: Record<Campo, string> = {
  telefono: 'Celular',
  email: 'Correo',
  direccion: 'Dirección',
  apoderado: 'Nombre del apoderado',
  apoderadoDni: 'DNI del apoderado',
  apoderadoTelefono: 'Celular del apoderado',
};
const valoresDe = (p: Paciente): Record<Campo, string> => ({
  telefono: p.telefono,
  email: p.email ?? '',
  direccion: p.direccion ?? '',
  apoderado: p.apoderado ?? '',
  apoderadoDni: p.apoderadoDni ?? '',
  apoderadoTelefono: p.apoderadoTelefono ?? '',
});

/**
 * CU-04 «Mis datos»: el paciente actualiza su contacto. El correo es obligatorio (es su usuario y por ahí recupera la
 * contraseña). El apoderado solo aparece si es menor de 18, y ahí no puede quedar vacío. Antes de guardar pregunta
 * «¿Guardar los cambios?» (Sí / No) mostrando solo lo que cambió.
 */
export function FormContacto({ paciente, onGuardar, onCancelar }: { paciente: Paciente; onGuardar: (d: ContactoDTO) => Promise<unknown>; onCancelar?: () => void }) {
  const [original, setOriginal] = useState(() => valoresDe(paciente));
  const [v, setV] = useState(original);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [porConfirmar, setPorConfirmar] = useState<ContactoDTO | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(false);
  const quitarHecho = useCallback(() => setHecho(false), []);

  const menor = esMenorDeEdad(paciente.fechaNacimiento);
  const campos: Campo[] = ['telefono', 'email', 'direccion', ...(menor ? (['apoderado', 'apoderadoDni', 'apoderadoTelefono'] as Campo[]) : [])];
  const cambiados = campos.filter((k) => v[k].trim() !== original[k]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = contactoSchema.safeParse(v);
    const c: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
    if (menor) {
      if (v.apoderado.trim().length < 3) c.apoderado ??= 'Ingrese el nombre del apoderado';
      if (!v.apoderadoDni) c.apoderadoDni ??= 'Ingrese el DNI del apoderado';
      if (!v.apoderadoTelefono) c.apoderadoTelefono ??= 'Ingrese el celular del apoderado';
    }
    setErrores(c);
    if (Object.keys(c).length === 0 && r.success) setPorConfirmar(r.data);
  }

  async function guardar() {
    if (!porConfirmar) return;
    setGuardando(true);
    try {
      await onGuardar(porConfirmar);
      setOriginal(v);
      setHecho(true);
    } catch (err) {
      setError(mensajeError(err));
      setErrores(camposApi(err));
    } finally {
      setGuardando(false);
      setPorConfirmar(null);
    }
  }

  const campo = (k: Campo, col: string, tipo = 'text') => {
    const opcional = k === 'direccion';
    return (
      <div className={col} key={k}>
        <label htmlFor={`c-${k}`} className={`form-label ${opcional ? '' : 'obligatorio'}`}>
          {ETIQUETAS[k]} {opcional && <small className="text-muted">(opcional)</small>}
        </label>
        {k === 'telefono' || k === 'apoderadoTelefono' || k === 'apoderadoDni' ? (
          <CampoDigitos id={`c-${k}`} value={v[k]} onChange={(x) => setV({ ...v, [k]: x })} largo={k === 'apoderadoDni' ? LARGO_NUMERICO.dni : LARGO_NUMERICO.celular} celular={k !== 'apoderadoDni'} error={errores[k]} />
        ) : (
          <>
            <input
              id={`c-${k}`}
              type={tipo}
              maxLength={k === 'direccion' ? LIMITE_TEXTO.direccion : k === 'apoderado' ? LIMITE_TEXTO.apoderado : undefined}
              className={`form-control ${errores[k] ? 'is-invalid' : ''}`}
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: k === 'apoderado' ? soloLetras(e.target.value).slice(0, LIMITE_TEXTO.apoderado) : e.target.value })}
              onBlur={k === 'email' ? (e) => setErrores({ ...errores, email: !e.target.value.trim() ? 'Ingrese su correo' : !correoValido(e.target.value) ? 'Correo inválido' : '' }) : undefined}
              aria-required={!opcional}
            />
            <div className="invalid-feedback">{errores[k]}</div>
          </>
        )}
        {k === 'email' && !errores.email && <div className="form-text">Con este correo inicia sesión y recupera su contraseña.</div>}
      </div>
    );
  };

  return (
    <form onSubmit={enviar} noValidate>
      <p className="small text-muted mb-2"><span className="text-danger">*</span> Campo obligatorio</p>
      <div className="row g-3">
        {campo('telefono', 'col-sm-6', 'tel')}
        {campo('email', 'col-sm-6', 'email')}
        {campo('direccion', 'col-12')}
        {menor && (
          <>
            <div className="col-12 small fw-semibold border-top pt-2">Es menor de edad: datos del padre, madre o tutor</div>
            {campo('apoderado', 'col-sm-6')}
            {campo('apoderadoDni', 'col-sm-3')}
            {campo('apoderadoTelefono', 'col-sm-3')}
          </>
        )}
      </div>
      {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}
      <div className="d-flex gap-2 mt-3">
        <button className="btn btn-acento" disabled={cambiados.length === 0} title={cambiados.length === 0 ? 'No hay cambios' : undefined}>Guardar cambios</button>
        {onCancelar && <button type="button" className="btn btn-outline-secondary" onClick={onCancelar}>Cerrar</button>}
      </div>
      <ConfirmarSiNo abierto={!!porConfirmar} titulo="¿Guardar los cambios?" ocupado={guardando} onNo={() => setPorConfirmar(null)} onSi={() => void guardar()}>
        {cambiados.map((k) => (
          <FilaResumen key={k} etiqueta={ETIQUETAS[k]}>
            <span className="text-muted fw-normal">{original[k] || '(vacío)'}</span> → {v[k].trim() || '(vacío)'}
          </FilaResumen>
        ))}
      </ConfirmarSiNo>
      {hecho && (
        <AvisoFlotante icono="✓" duracion={4000} onCerrar={quitarHecho}>
          Datos actualizados
        </AvisoFlotante>
      )}
    </form>
  );
}
