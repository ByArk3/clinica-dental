import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Rol } from '@clinica/shared';
import { useAuth } from './auth';
import { MenuPorRol } from './components/MenuPorRol';
import Login from './pages/Login';
import { Recuperar, Restablecer } from './pages/Recuperar';
import RegistroPaciente from './pages/RegistroPaciente';
import { MisCitas, ReservaWeb } from './pages/ReservaWeb';
import NuevaCita from './pages/NuevaCita';
import Inicio from './pages/Inicio';

export const rutaInicio = (rol: Rol) =>
  ({ paciente: '/reservar', recepcionista: '/citas/nueva', odontologo: '/inicio', administrador: '/inicio' })[rol];

/** Rutas protegidas por rol (RNF07). La API vuelve a validar el rol: esto es solo navegación. */
function Protegida({ roles }: { roles?: Rol[] }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <p className="p-4 text-muted">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(usuario.rol)) return <Navigate to={rutaInicio(usuario.rol)} replace />;
  return (
    <div className="layout">
      <MenuPorRol />
      <main className="contenido">
        <Outlet />
      </main>
    </div>
  );
}

export function Rutas() {
  const { usuario } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/recuperar" element={<Recuperar />} />
      <Route path="/restablecer" element={<Restablecer />} />
      <Route path="/registro" element={<RegistroPaciente />} />
      <Route element={<Protegida roles={['paciente']} />}>
        <Route path="/reservar" element={<ReservaWeb />} />
        <Route path="/mis-citas" element={<MisCitas />} />
      </Route>
      <Route element={<Protegida roles={['recepcionista']} />}>
        <Route path="/citas/nueva" element={<NuevaCita />} />
      </Route>
      <Route element={<Protegida />}>
        <Route path="/inicio" element={<Inicio />} />
      </Route>
      <Route path="*" element={<Navigate to={usuario ? rutaInicio(usuario.rol) : '/login'} replace />} />
    </Routes>
  );
}
