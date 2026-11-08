import { useState, type FormEvent } from 'react';
import { contactoSchema, type ContactoDTO, LARGO_NUMERICO, LIMITE_TEXTO } from '@clinica/shared';
import type { Paciente } from '../api/recursos';
import { CampoDigitos } from './Interaccion';
import { mensajeError } from '../formato';

/** CU-04 Actualizar datos de contacto del paciente. */
export function FormContacto({ paciente, onGuardar, onCancelar }: { paciente: Paciente; onGuardar: (d: ContactoDTO) => Promise<unknown>; onCancelar?: () => void }) {
  const [v, setV] = useState<Record<string, string>>({
    telefono: paciente.telefono,
    email: paciente.email ?? '',
    direccion: paciente.direccion ?? '',
    apoderado: paciente.apoderado ?? '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEstado({});
    const r = contactoSchema.safeParse(v);
    if (!r.success) {
      const c: Record<string, string> = {};
      for (const i of r.error.issues) c[i.path.join('.')] ??= i.message;
      return setErrores(c);
    }
    setErrores({});
    try {
      await onGuardar(r.data);
      setEstado({ ok: 'Datos de contacto actualizados' });
    } catch (err) {
      setEstado({ error: mensajeError(err) });
    }
  }

  const campo = (nombre: string, etiqueta: string, tipo = 'text') => (
    <div className="col-sm-6">
      <label htmlFor={`c-${nombre}`} className="form-label">{etiqueta}</label>
      {nombre === 'telefono' ? (
        <CampoDigitos id={`c-${nombre}`} value={v[nombre]} onChange={(x) => setV({ ...v, [nombre]: x })} largo={LARGO_NUMERICO.celular} error={errores[nombre]} />
      ) : (
        <>
          <input id={`c-${nombre}`} type={tipo} maxLength={nombre === 'direccion' ? LIMITE_TEXTO.direccion : nombre === 'apoderado' ? LIMITE_TEXTO.apoderado : undefined} className={`form-control ${errores[nombre] ? 'is-invalid' : ''}`} value={v[nombre]} onChange={(e) => setV({ ...v, [nombre]: e.target.value })} />
          <div className="invalid-feedback">{errores[nombre]}</div>
        </>
      )}
    </div>
  );

  return (
    <form onSubmit={enviar} noValidate>
      <div className="row g-3">
        {campo('telefono', 'Celular', 'tel')}
        {campo('email', 'Correo', 'email')}
        {campo('direccion', 'Dirección')}
        {campo('apoderado', 'Apoderado (menores)')}
      </div>
      {estado.ok && <div className="alert alert-success mt-3 mb-0">{estado.ok}</div>}
      {estado.error && <div className="alert alert-danger mt-3 mb-0" role="alert">{estado.error}</div>}
      <div className="d-flex gap-2 mt-3">
        <button className="btn btn-acento">Guardar cambios</button>
        {onCancelar && <button type="button" className="btn btn-outline-secondary" onClick={onCancelar}>Cerrar</button>}
      </div>
    </form>
  );
}
