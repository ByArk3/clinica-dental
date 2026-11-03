import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { passwordSchema } from '@clinica/shared';
import { authApi } from '../api/recursos';
import { ApiError } from '../api/cliente';

/** CU-02 Recuperar contraseña: paso 1, pedir el enlace por correo. */
export function Recuperar() {
  const [email, setEmail] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setMensaje((await authApi.recuperar(email)).mensaje);
  }
  return (
    <div className="pantalla-acceso">
      <form className="tarjeta acceso" onSubmit={enviar}>
        <h1 className="h5">Recuperar contraseña</h1>
        {mensaje ? (
          <div className="alert alert-info">{mensaje}</div>
        ) : (
          <>
            <label htmlFor="email" className="form-label">Correo de su cuenta</label>
            <input id="email" type="email" className="form-control mb-3" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn btn-acento w-100">Enviar enlace</button>
          </>
        )}
        <Link to="/login" className="d-block mt-3 small">Volver a iniciar sesión</Link>
      </form>
    </div>
  );
}

/** CU-02 paso 2: nueva contraseña con el enlace del correo (válido 30 min). */
export function Restablecer() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    const v = passwordSchema.safeParse(password);
    if (!v.success) return setError(v.error.issues[0].message);
    try {
      setListo((await authApi.restablecer(params.get('token') ?? '', password)).mensaje);
    } catch (err) {
      setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    }
  }
  return (
    <div className="pantalla-acceso">
      <form className="tarjeta acceso" onSubmit={enviar}>
        <h1 className="h5">Nueva contraseña</h1>
        {listo ? (
          <div className="alert alert-success">{listo}</div>
        ) : (
          <>
            <label htmlFor="password" className="form-label">Contraseña nueva</label>
            <input id="password" type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="small text-muted mt-1">Mínimo 8 caracteres, con letras y números.</p>
            {error && <div className="alert alert-danger">{error}</div>}
            <button className="btn btn-acento w-100">Guardar</button>
          </>
        )}
        <Link to="/login" className="d-block mt-3 small">Ir a iniciar sesión</Link>
      </form>
    </div>
  );
}
