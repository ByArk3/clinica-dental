import { NavLink } from 'react-router-dom';
import { Nav, Navbar } from 'react-bootstrap';
import type { Rol } from '@clinica/shared';
import { useState } from 'react';
import { useAuth } from '../auth';
import { aplicarTema, temaGuardado, type Tema } from '../tema';

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
    { texto: 'Caja', ruta: '/caja' },
  ],
  odontologo: [
    { texto: 'Mis citas del día', ruta: '/atencion' },
    { texto: 'Historial clínico', ruta: '/historial' },
  ],
  administrador: [
    { texto: 'Panel', ruta: '/panel' },
    { texto: 'Historial clínico', ruta: '/historial' },
    { texto: 'Tarifario', ruta: '/tarifario' },
    { texto: 'Insumos', ruta: '/insumos' },
    { texto: 'Alertas de stock', ruta: '/alertas' },
    { texto: 'Pedidos', ruta: '/pedidos' },
    { texto: 'Proveedores', ruta: '/proveedores' },
    { texto: 'Usuarios', ruta: '/usuarios' },
    { texto: 'Reportes', ruta: '/reportes' },
    { texto: 'Auditoría', ruta: '/auditoria' },
    { texto: 'Configuración', ruta: '/configuracion' },
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
  const [tema, setTema] = useState<Tema>(temaGuardado);
  if (!usuario) return null;
  const cambiarTema = () => {
    const t: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
    aplicarTema(t);
    setTema(t);
  };
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
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-outline-light" onClick={salir}>
              Cerrar sesión
            </button>
            <button
              className="btn btn-sm btn-outline-light"
              onClick={cambiarTema}
              aria-label={tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              title={tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'}
            >
              {tema === 'oscuro' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </Navbar.Collapse>
    </Navbar>
  );
}
