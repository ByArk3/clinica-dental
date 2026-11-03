import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { authApi } from '../api/recursos';
import { ApiError } from '../api/cliente';
import { useAuth } from '../auth';
import { rutaInicio } from '../routes';

/** CU-01 Iniciar sesión */
export default function Login() {
  const { usuario, setUsuario } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={rutaInicio(usuario.rol)} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      setUsuario(await authApi.login(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.datos.mensaje : 'No se pudo conectar con el servidor');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pantalla-acceso">
      <form className="tarjeta acceso" onSubmit={enviar}>
        <h1 className="h4 mb-1">🦷 Clínica Dental</h1>
        <p className="text-muted mb-4">Ingrese a su cuenta</p>
        <div className="mb-3">
          <label htmlFor="email" className="form-label">Correo</label>
          <input id="email" type="email" className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="mb-3">
          <label htmlFor="password" className="form-label">Contraseña</label>
          <input id="password" type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <button className="btn btn-acento w-100" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
        <div className="d-flex justify-content-between mt-3 small">
          <Link to="/recuperar">¿Olvidó su contraseña?</Link>
          <Link to="/registro">Soy paciente: crear cuenta</Link>
        </div>
      </form>
    </div>
  );
}
