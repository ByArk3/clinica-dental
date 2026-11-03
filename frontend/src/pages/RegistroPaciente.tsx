import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/recursos';
import { useAuth } from '../auth';
import { FormPaciente } from '../components/FormPaciente';

/** CU-03 (web): el paciente crea su cuenta y pasa directo a reservar. */
export default function RegistroPaciente() {
  const { setUsuario } = useAuth();
  const navegar = useNavigate();
  return (
    <div className="pantalla-acceso">
      <div className="tarjeta" style={{ maxWidth: 760, width: '100%' }}>
        <h1 className="h5">Crear cuenta de paciente</h1>
        <p className="text-muted small">Si ya se atendió en la clínica, use el mismo DNI: su cuenta se vinculará a su ficha.</p>
        <FormPaciente
          conCuenta
          textoBoton="Crear cuenta"
          onEnviar={async (datos) => {
            setUsuario(await authApi.registroPaciente(datos));
            navegar('/reservar');
          }}
        />
        <Link to="/login" className="d-block mt-3 small">Ya tengo cuenta</Link>
      </div>
    </div>
  );
}
