import type { AjusteDTO, DescuentoDTO, EstadoPedido, PedidoDTO, ProveedorDTO, RecepcionDTO, Rol, UsuarioModificarDTO, UsuarioNuevoDTO, ComprobanteDTO, Importe, TipoCobro, AtencionDTO, InsumoDTO, InsumoNuevoDTO, TratamientoDTO, CitaConfirmacion, CitaDTO, ContactoDTO, Disponibilidad, PacienteDTO, RegistroPacienteDTO, ReprogramarDTO, UsuarioSesion, EstadoCita, Canal } from '@clinica/shared';
import { api } from './cliente';

export interface Paciente {
  id: number;
  dni: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  telefono: string;
  email: string | null;
  direccion?: string | null;
  apoderado?: string | null;
  inasistencias: number;
  restringido: boolean;
}
export interface Odontologo {
  id: number;
  nombres: string;
  especialidad: string | null;
}
export interface Cita {
  id: number;
  pacienteId: number;
  odontologoId: number;
  odontologo: string;
  fecha: string;
  hora: string;
  motivo: string;
  canal: Canal;
  estado: EstadoCita;
}

export interface CitaDelDia extends Cita {
  paciente: Pick<Paciente, 'id' | 'dni' | 'nombres' | 'apellidos' | 'telefono' | 'inasistencias' | 'restringido'>;
  puedeRegistrarInasistencia: boolean;
  whatsapp?: string;
}

export const authApi = {
  yo: () => api<UsuarioSesion>('/auth/yo'),
  login: (email: string, password: string) => api<UsuarioSesion>('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  recuperar: (email: string) => api<{ mensaje: string }>('/auth/recuperar', { method: 'POST', body: { email } }),
  restablecer: (token: string, password: string) =>
    api<{ mensaje: string }>('/auth/restablecer', { method: 'POST', body: { token, password } }),
  registroPaciente: (datos: RegistroPacienteDTO) =>
    api<UsuarioSesion>('/auth/registro-paciente', { method: 'POST', body: datos }),
};

export const pacientesApi = {
  porDni: (dni: string) => api<Paciente>(`/pacientes?dni=${encodeURIComponent(dni)}`),
  registrar: (datos: PacienteDTO) => api<Paciente>('/pacientes', { method: 'POST', body: datos }),
  miPerfil: () => api<Paciente>('/pacientes/me'),
  actualizarMiContacto: (datos: ContactoDTO) => api<Paciente>('/pacientes/me', { method: 'PATCH', body: datos }),
  actualizarContacto: (id: number, datos: ContactoDTO) =>
    api<Paciente>(`/pacientes/${id}/contacto`, { method: 'PATCH', body: datos }),
};

export const citasApi = {
  odontologos: () => api<Odontologo[]>('/odontologos'),
  disponibilidad: (odontologoId: number, fecha: string) =>
    api<Disponibilidad>(`/disponibilidad?odontologoId=${odontologoId}&fecha=${fecha}`),
  registrar: (datos: CitaDTO) => api<{ cita: Cita; aviso?: string }>('/citas', { method: 'POST', body: datos }),
  mias: () => api<Cita[]>('/citas/mias'),
  reprogramar: (id: number, datos: ReprogramarDTO) => api<Cita>(`/citas/${id}/reprogramar`, { method: 'PATCH', body: datos }),
  cancelar: (id: number) => api<Cita>(`/citas/${id}/cancelar`, { method: 'PATCH' }),
  delDia: (fecha: string) => api<CitaDelDia[]>(`/citas?fecha=${fecha}`),
  inasistencia: (id: number) =>
    api<{ inasistencias: number; restringido: boolean; aviso?: string }>(`/citas/${id}/inasistencia`, { method: 'POST' }),
  verConfirmacion: (token: string) => api<CitaConfirmacion>(`/citas/confirmar/${encodeURIComponent(token)}`),
  responderConfirmacion: (token: string, accion: 'confirmar' | 'cancelar') =>
    api<CitaConfirmacion>(`/citas/confirmar/${encodeURIComponent(token)}`, { method: 'POST', body: { accion } }),
};

// ---------- Iteración 2: tarifario, insumos, historial y atención ----------

export interface InsumoDeTratamiento {
  insumoId: number;
  nombre: string;
  unidad: string;
  cantidad: string;
  stockActual: string;
  stockMinimo: string;
}
export interface Tratamiento {
  id: number;
  nombre: string;
  precio: string;
  activo: boolean;
  insumos: InsumoDeTratamiento[];
}
export interface Insumo {
  id: number;
  nombre: string;
  unidad: string;
  stockActual: string;
  stockMinimo: string;
  bajoMinimo: boolean;
  activo: boolean;
}
export interface MovimientoKardex {
  id: number;
  fecha: string;
  tipo: 'entrada_recepcion' | 'salida_tratamiento' | 'ajuste' | 'merma' | 'inicial';
  cantidad: string;
  saldo: string;
  motivo: string | null;
  referencia: string | null;
  usuario: string;
}
export interface Alerta {
  id: number;
  fecha: string;
  stockAlGenerar: string;
  revisada: boolean;
  revisadaPor: string | null;
  revisadaEn: string | null;
  insumo: Insumo;
}
export interface PacienteEncontrado {
  id: number;
  dni: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  atenciones: number;
}
export interface Historial {
  paciente: { id: number; dni: string; nombres: string; apellidos: string; fechaNacimiento: string; telefono: string; apoderado: string | null; inasistencias: number };
  ficha: { alergias: string | null; antecedentes: string | null; notas: string | null };
  atenciones: {
    id: number;
    fecha: string;
    hora: string;
    motivo: string;
    odontologo: string;
    diagnostico: string;
    observaciones: string | null;
    tratamientos: { nombre: string; piezaDental: string | null; precio: string }[];
  }[];
  mensaje?: string;
}
export interface CitaOdontologo {
  id: number;
  fecha: string;
  hora: string;
  motivo: string;
  estado: EstadoCita;
  puedeAtender: boolean;
  paciente: { id: number; dni: string; nombres: string; apellidos: string; fechaNacimiento: string; alergias: string | null };
}
export interface ResultadoAtencion {
  atencionId: number;
  citaId: number;
  total: string;
  insumos: { insumo: string; unidad: string; cantidad: string; saldo: string; faltante?: string; alertaGenerada: boolean }[];
  alertas: string[];
}

const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  return s ? `?${s}` : '';
};

export const tarifarioApi = {
  listar: (f: { q?: string; activo?: string } = {}) => api<Tratamiento[]>(`/tratamientos${qs(f)}`),
  crear: (d: TratamientoDTO) => api<Tratamiento>('/tratamientos', { method: 'POST', body: d }),
  modificar: (id: number, d: TratamientoDTO) => api<Tratamiento>(`/tratamientos/${id}`, { method: 'PATCH', body: d }),
  cambiarEstado: (id: number, activo: boolean) =>
    api<Tratamiento>(`/tratamientos/${id}/${activo ? 'activar' : 'desactivar'}`, { method: 'PATCH' }),
};

export const insumosApi = {
  listar: (f: { q?: string; activo?: string; bajoMinimo?: string } = {}) => api<Insumo[]>(`/insumos${qs(f)}`),
  buscar: (q: string) => api<Insumo[]>(`/insumos/buscar${qs({ q })}`),
  crear: (d: InsumoNuevoDTO) => api<Insumo>('/insumos', { method: 'POST', body: d }),
  modificar: (id: number, d: InsumoDTO) => api<Insumo>(`/insumos/${id}`, { method: 'PATCH', body: d }),
  cambiarEstado: (id: number, activo: boolean) => api<Insumo>(`/insumos/${id}/${activo ? 'activar' : 'desactivar'}`, { method: 'PATCH' }),
  kardex: (id: number, f: { desde?: string; hasta?: string; tipo?: string } = {}) =>
    api<{ insumo: Insumo; movimientos: MovimientoKardex[] }>(`/insumos/${id}/kardex${qs(f)}`),
  alertas: (f: { todas?: string } = {}) => api<Alerta[]>(`/alertas${qs(f)}`),
  revisarAlerta: (id: number) => api<Alerta>(`/alertas/${id}/revisar`, { method: 'PATCH' }),
  ajuste: (id: number, d: AjusteDTO) =>
    api<{ saldo: string; alertaGenerada: boolean; insumo: Insumo }>(`/insumos/${id}/ajuste`, { method: 'POST', body: d }),
};

export const historialApi = {
  buscar: (q: string) => api<PacienteEncontrado[]>(`/pacientes/buscar${qs({ q })}`),
  ver: (pacienteId: number) => api<Historial>(`/pacientes/${pacienteId}/historial`),
};

export const atencionApi = {
  misCitas: (fecha: string) => api<CitaOdontologo[]>(`/odontologos/me/citas${qs({ fecha })}`),
  registrar: (citaId: number, d: AtencionDTO) => api<ResultadoAtencion>(`/citas/${citaId}/atencion`, { method: 'POST', body: d }),
};

// ---------- Iteración 3: caja ----------
export interface PendienteCaja {
  citaId: number;
  tipo: TipoCobro;
  fecha: string;
  hora: string;
  odontologo: string;
  paciente: { id: number; dni: string; nombres: string; apellidos: string };
  importe: string;
}
export interface Comprobante {
  id: number;
  numero: string;
  tipo: TipoCobro;
  citaId: number;
  estadoCita: EstadoCita;
  fecha: string;
  paciente: { dni: string; nombres: string; apellidos: string; tieneCorreo: boolean };
  tipoPago: string;
  descuento: { nombre: string; monto: string } | null;
  lineas: { descripcion: string; precio: string }[];
  subtotal: string;
  adelantoAplicado: string;
  total: string;
  montoRecibido: string;
  vuelto: string;
  enviadoEmail: boolean;
  emitidoPor: string;
}

export const cajaApi = {
  pendientes: () => api<PendienteCaja[]>('/caja/pendientes'),
  importe: (citaId: number, descuentoId?: number) =>
    api<Importe>(`/caja/citas/${citaId}/importe${qs({ descuentoId: descuentoId ? String(descuentoId) : undefined })}`),
  emitir: (citaId: number, d: ComprobanteDTO) => api<Comprobante>(`/caja/citas/${citaId}/comprobante`, { method: 'POST', body: d }),
  tiposPago: () => api<{ id: number; nombre: string }[]>('/tipos-pago'),
  descuentos: () => api<{ id: number; nombre: string; porcentaje: string }[]>('/descuentos'),
  enviar: (id: number) => api<{ mensaje: string }>(`/comprobantes/${id}/enviar`, { method: 'POST' }),
  /** Descarga el PDF; si falla, lanza error (10.1: el comprobante ya está registrado y se puede reintentar). */
  pdf: async (id: number) => {
    const r = await fetch(`/api/comprobantes/${id}/pdf`, { credentials: 'include' });
    if (!r.ok) throw new Error('pdf');
    return r.blob();
  },
};

// ---------- Iteración 4: proveedores, pedidos, usuarios, configuración, panel y reportes ----------
export interface Proveedor {
  id: number;
  ruc: string;
  razonSocial: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
}
export interface Pedido {
  id: number;
  codigo: string;
  estado: EstadoPedido;
  fecha: string;
  recibidoEn: string | null;
  motivoAnulacion: string | null;
  observacionRecepcion: string | null;
  registradoPor: string;
  proveedor: { id: number; ruc: string; razonSocial: string; email: string | null };
  detalles: { id: number; insumoId: number; insumo: string; unidad: string; stockActual: string; cantidadPedida: string; cantidadRecibida: string | null }[];
}
export interface Usuario {
  id: number;
  nombres: string;
  email: string;
  rol: Rol;
  activo: boolean;
  cmp: string | null;
  especialidad: string | null;
  dni: string | null;
}
export interface Descuento { id: number; nombre: string; porcentaje: string; activo: boolean }
export interface Panel {
  fecha: string;
  citasHoy: { total: number; porEstado: Partial<Record<EstadoCita, number>> };
  ingresos: { hoy: string; comprobantesHoy: number; mes: string; comprobantesMes: number; ultimos7Dias: { fecha: string; total: string }[] };
  inventario: { alertasPendientes: number; alertas: { id: number; insumo: string; unidad: string; stockActual: string; stockMinimo: string }[]; pedidosPendientes: number };
  agenda: { porConfirmar48h: number; inasistenciasMes: number; pacientesRestringidos: number };
}
export interface ReporteIngresos {
  desde: string;
  hasta: string;
  resumen: { total: string; comprobantes: number; ticketPromedio: string; descuentos: string; adelantos: string };
  porTipoPago: { tipo: string; total: string; cantidad: number }[];
  porDia: { fecha: string; total: string }[];
  porTratamiento: { tratamiento: string; cantidad: number; importe: string }[];
  detalle: { numero: string; fecha: string; tipo: TipoCobro; paciente: string; dni: string; tipoPago: string; subtotal: string; descuento: string; adelantoAplicado: string; total: string }[];
}
export interface ReporteInventario {
  desde: string;
  hasta: string;
  resumen: { insumosActivos: number; bajoMinimo: number; pedidos: Partial<Record<EstadoPedido, number>> };
  insumos: { id: number; nombre: string; unidad: string; activo: boolean; stockActual: string; stockMinimo: string; bajoMinimo: boolean; entradas: string; consumo: string; ajustes: string; mermas: string }[];
}

export const proveedoresApi = {
  listar: (f: { q?: string; activo?: string } = {}) => api<Proveedor[]>(`/proveedores${qs(f)}`),
  crear: (d: ProveedorDTO) => api<Proveedor>('/proveedores', { method: 'POST', body: d }),
  modificar: (id: number, d: ProveedorDTO) => api<Proveedor>(`/proveedores/${id}`, { method: 'PATCH', body: d }),
  cambiarEstado: (id: number, activo: boolean) => api<Proveedor>(`/proveedores/${id}/${activo ? 'activar' : 'desactivar'}`, { method: 'PATCH' }),
};

export const pedidosApi = {
  listar: (f: { estado?: string; q?: string } = {}) => api<{ pedidos: Pedido[]; mensaje?: string }>(`/pedidos${qs(f)}`),
  ver: (id: number) => api<Pedido>(`/pedidos/${id}`),
  registrar: (d: PedidoDTO) => api<Pedido>('/pedidos', { method: 'POST', body: d }),
  anular: (id: number, motivo: string) => api<Pedido>(`/pedidos/${id}/anular`, { method: 'PATCH', body: { motivo } }),
  recepcion: (id: number, d: RecepcionDTO) => api<Pedido>(`/pedidos/${id}/recepcion`, { method: 'POST', body: d }),
  enviar: (id: number) => api<{ mensaje: string }>(`/pedidos/${id}/enviar`, { method: 'POST' }),
  pdfUrl: (id: number) => `/api/pedidos/${id}/pdf`,
};

export const usuariosApi = {
  listar: (f: { q?: string; rol?: string; activo?: string } = {}) => api<Usuario[]>(`/usuarios${qs(f)}`),
  crear: (d: UsuarioNuevoDTO) => api<Usuario>('/usuarios', { method: 'POST', body: d }),
  modificar: (id: number, d: UsuarioModificarDTO) => api<Usuario>(`/usuarios/${id}`, { method: 'PATCH', body: d }),
  cambiarEstado: (id: number, activo: boolean) => api<Usuario>(`/usuarios/${id}/${activo ? 'activar' : 'desactivar'}`, { method: 'PATCH' }),
};

export const configApi = {
  descuentos: () => api<Descuento[]>('/admin/descuentos'),
  crearDescuento: (d: DescuentoDTO) => api<Descuento>('/admin/descuentos', { method: 'POST', body: d }),
  modificarDescuento: (id: number, d: DescuentoDTO) => api<Descuento>(`/admin/descuentos/${id}`, { method: 'PATCH', body: d }),
  estadoDescuento: (id: number, activo: boolean) => api<Descuento>(`/admin/descuentos/${id}/${activo ? 'activar' : 'desactivar'}`, { method: 'PATCH' }),
  adelanto: () => api<{ monto: string }>('/admin/adelanto'),
  cambiarAdelanto: (monto: number) => api<{ monto: string }>('/admin/adelanto', { method: 'PUT', body: { monto } }),
};

export const reportesApi = {
  panel: () => api<Panel>('/panel'),
  ingresos: (desde: string, hasta: string) => api<ReporteIngresos>(`/reportes/ingresos${qs({ desde, hasta })}`),
  inventario: (desde: string, hasta: string) => api<ReporteInventario>(`/reportes/inventario${qs({ desde, hasta })}`),
  csvUrl: (tipo: 'ingresos' | 'inventario', desde: string, hasta: string) => `/api/reportes/${tipo}${qs({ desde, hasta, formato: 'csv' })}`,
};
