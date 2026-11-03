import type { CitaDTO, Disponibilidad, PacienteDTO, RegistroPacienteDTO, UsuarioSesion, EstadoCita, Canal } from '@clinica/shared';
import { api } from './cliente';

export interface Paciente {
  id: number;
  dni: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  telefono: string;
  email: string | null;
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
};

export const citasApi = {
  odontologos: () => api<Odontologo[]>('/odontologos'),
  disponibilidad: (odontologoId: number, fecha: string) =>
    api<Disponibilidad>(`/disponibilidad?odontologoId=${odontologoId}&fecha=${fecha}`),
  registrar: (datos: CitaDTO) => api<{ cita: Cita; aviso?: string }>('/citas', { method: 'POST', body: datos }),
  mias: () => api<Cita[]>('/citas/mias'),
};
