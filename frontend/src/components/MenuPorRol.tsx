import { NavLink } from 'react-router-dom';
import { Nav, Navbar } from 'react-bootstrap';
import type { Rol } from '@clinica/shared';
import { useAuth } from '../auth';

interface Item {
  texto: string;
  ruta?: string; // sin ruta = módulo de una iteración posterior
}

const MENU: Record<Rol, Item[]> = {
  paciente: [
    { texto: 'Reservar cita', ruta: '/reservar' },
    { texto: 'Mis citas', ruta: '/mis-citas' },
    { texto: 'Mis datos', ruta: '/mis-datos' },
  ],
  recepcionista: [
    { texto: 'Nueva cita', ruta: '/citas/nueva' },
    { texto: 'Citas del día', ruta: '/citas/dia' },
    { texto: 'Caja' },
  ],
  odontologo: [{ texto: 'Mis citas del día' }, { texto: 'Historial clínico' }],
  administrador: [
    { texto: 'Panel' },
    { texto: 'Historial clínico' },
    { texto: 'Tarifario' },
    { texto: 'Insumos' },
    { texto: 'Pedidos' },
    { texto: 'Proveedores' },
    { texto: 'Usuarios' },
  ],
};

const ROL_PE: Record<Rol, string> = {
  paciente: 'Paciente',
  recepcionista: 'Recepcionista',
  odontologo: 'Odontólogo',
  administrador: 'Administrador',
};

export function MenuPorRol() {
  const { usuario, salir } = useAuth();
  if (!usuario) return null;
  return (
    <Navbar expand="md" variant="dark" className="barra-lateral flex-md-column align-items-stretch p-3">
      <Navbar.Brand className="fw-bold mb-md-3">🦷 Clínica Dental</Navbar.Brand>
      <Navbar.Toggle aria-controls="menu-principal" aria-label="Abrir menú" />
      <Navbar.Collapse id="menu-principal" className="flex-md-column align-items-stretch">
        <Nav className="flex-column w-100">
          {MENU[usuario.rol].map((i) =>
            i.ruta ? (
              <Nav.Link as={NavLink} to={i.ruta} key={i.texto}>
                {i.texto}
              </Nav.Link>
            ) : (
              <Nav.Link key={i.texto} disabled title="Disponible en una próxima iteración">
                {i.texto} <small>(próx.)</small>
              </Nav.Link>
            ),
          )}
        </Nav>
        <div className="mt-md-auto pt-3 border-top border-secondary small">
          <div className="text-white">{usuario.nombres}</div>
          <div className="text-white-50 mb-2">{ROL_PE[usuario.rol]}</div>
          <button className="btn btn-sm btn-outline-light" onClick={salir}>
            Cerrar sesión
          </button>
        </div>
      </Navbar.Collapse>
    </Navbar>
  );
}
