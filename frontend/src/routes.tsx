import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Rol } from '@clinica/shared';
import { useAuth } from './auth';
import { MenuPorRol } from './components/MenuPorRol';
import Login from './pages/Login';
import { Recuperar, Restablecer } from './pages/Recuperar';
import RegistroPaciente from './pages/RegistroPaciente';
import { MisCitas, ReservaWeb } from './pages/ReservaWeb';
import NuevaCita from './pages/NuevaCita';
import Inicio from './pages/Inicio';
import CitasDelDia from './pages/CitasDelDia';
import ConfirmarCita from './pages/ConfirmarCita';
import MiPerfil from './pages/MiPerfil';
import Historial from './pages/Historial';
import MisCitasOdontologo from './pages/MisCitasOdontologo';
import RegistrarAtencion from './pages/RegistrarAtencion';
import Tarifario from './pages/Tarifario';
import Insumos from './pages/Insumos';
import Caja from './pages/Caja';
import Panel from './pages/Panel';
import Proveedores from './pages/Proveedores';
import Pedidos from './pages/Pedidos';
import NuevoPedido from './pages/NuevoPedido';
import RecepcionPedido from './pages/RecepcionPedido';
import Alertas from './pages/Alertas';
import Usuarios from './pages/Usuarios';
import Configuracion from './pages/Configuracion';
import Reportes from './pages/Reportes';
import Auditoria from './pages/Auditoria';
import EditarAtencion from './pages/EditarAtencion';

export const rutaInicio = (rol: Rol) =>
  ({ paciente: '/reservar', recepcionista: '/citas/dia', odontologo: '/atencion', administrador: '/panel' })[rol];

/** Rutas protegidas por rol (RNF07). La API vuelve a validar el rol: esto es solo navegación. */
function Protegida({ roles }: { roles?: Rol[] }) {
  const { usuario, cargando } = useAuth();
  const { pathname } = useLocation();
  if (cargando) return <p className="p-4 text-muted">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(usuario.rol)) return <Navigate to={rutaInicio(usuario.rol)} replace />;
  return (
    <div className="layout">
      <MenuPorRol />
      <main className="contenido">
        {/* key: cada pantalla entra con un fundido corto */}
        <div className="pantalla" key={pathname}>
          <Outlet />
        </div>
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
      <Route path="/citas/confirmar/:token" element={<ConfirmarCita />} />
      <Route element={<Protegida roles={['paciente']} />}>
        <Route path="/reservar" element={<ReservaWeb />} />
        <Route path="/mis-citas" element={<MisCitas />} />
        <Route path="/mis-datos" element={<MiPerfil />} />
      </Route>
      <Route element={<Protegida roles={['recepcionista']} />}>
        <Route path="/citas/nueva" element={<NuevaCita />} />
        <Route path="/citas/dia" element={<CitasDelDia />} />
        <Route path="/caja" element={<Caja />} />
      </Route>
      <Route element={<Protegida roles={['odontologo']} />}>
        <Route path="/atencion" element={<MisCitasOdontologo />} />
        <Route path="/atencion/:citaId" element={<RegistrarAtencion />} />
        <Route path="/atencion/editar/:atencionId" element={<EditarAtencion />} />
      </Route>
      <Route element={<Protegida roles={['odontologo', 'administrador']} />}>
        <Route path="/historial" element={<Historial />} />
      </Route>
      <Route element={<Protegida roles={['administrador']} />}>
        <Route path="/tarifario" element={<Tarifario />} />
        <Route path="/insumos" element={<Insumos />} />
        <Route path="/panel" element={<Panel />} />
        <Route path="/alertas" element={<Alertas />} />
        <Route path="/proveedores" element={<Proveedores />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/pedidos/nuevo" element={<NuevoPedido />} />
        <Route path="/pedidos/:id/recepcion" element={<RecepcionPedido />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/configuracion" element={<Configuracion />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/auditoria" element={<Auditoria />} />
      </Route>
      <Route element={<Protegida />}>
        <Route path="/inicio" element={<Inicio />} />
      </Route>
      <Route path="*" element={<Navigate to={usuario ? rutaInicio(usuario.rol) : '/login'} replace />} />
    </Routes>
  );
}
