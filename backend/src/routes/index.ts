import { Router } from 'express';
import * as Auth from '../controllers/auth.controller.js';
import * as Pacientes from '../controllers/paciente.controller.js';
import * as Citas from '../controllers/cita.controller.js';
import * as Inventario from '../controllers/inventario.controller.js';
import * as Atencion from '../controllers/atencion.controller.js';
import { requireAuth, requireRol, requireRolConMensaje } from '../middlewares/auth.js';
import { MENSAJES } from '@clinica/shared';

// Express 5 propaga al manejador de errores los rechazos de los controladores async.
export const rutas = Router();

// CU-01 / CU-02 / CU-03 (web)
rutas.post('/auth/login', Auth.login);
rutas.post('/auth/logout', Auth.logout);
rutas.get('/auth/yo', requireAuth, Auth.yo);
rutas.post('/auth/recuperar', Auth.recuperar);
rutas.post('/auth/restablecer', Auth.restablecer);
rutas.post('/auth/registro-paciente', Auth.registroPaciente);

// CU-03 (presencial) y búsqueda por DNI (CU-06 presencial)
rutas.post('/pacientes', requireRol('recepcionista'), Pacientes.registrar);
rutas.get('/pacientes', requireRol('recepcionista'), Pacientes.buscarPorDni);

// CU-10 Historial clínico — RN-07: solo Odontólogo y Administrador
const soloClinico = requireRolConMensaje(MENSAJES.SIN_PERMISO_HISTORIAL, 'odontologo', 'administrador');
rutas.get('/pacientes/buscar', soloClinico, Atencion.buscarPacientes);
rutas.get('/pacientes/:id/historial', soloClinico, Atencion.historial);

// CU-04 Actualizar datos de contacto
rutas.get('/pacientes/me', requireRol('paciente'), Pacientes.miPerfil);
rutas.patch('/pacientes/me', requireRol('paciente'), Pacientes.actualizarMiContacto);
rutas.patch('/pacientes/:id/contacto', requireRol('recepcionista'), Pacientes.actualizarContacto);

// CU-05 / CU-06
rutas.get('/odontologos', requireAuth, Citas.odontologos);
rutas.get('/disponibilidad', requireRol('paciente', 'recepcionista'), Citas.disponibilidad);
rutas.post('/citas', requireRol('paciente', 'recepcionista'), Citas.registrar);
rutas.get('/citas/mias', requireRol('paciente'), Citas.mias);

// CU-08 Confirmar cita (público, con el token del recordatorio)
rutas.get('/citas/confirmar/:token', Citas.verConfirmacion);
rutas.post('/citas/confirmar/:token', Citas.responderConfirmacion);

// CU-07 Reprogramar / cancelar
rutas.patch('/citas/:id/reprogramar', requireRol('paciente', 'recepcionista'), Citas.reprogramar);
rutas.patch('/citas/:id/cancelar', requireRol('paciente', 'recepcionista'), Citas.cancelar);

// CU-09 Citas del día e inasistencias
rutas.get('/citas', requireRol('recepcionista'), Citas.delDia);
rutas.post('/citas/:id/inasistencia', requireRol('recepcionista'), Citas.inasistencia);

// CU-11 Registrar atención — RN-06: solo el odontólogo
rutas.get('/odontologos/me/citas', requireRol('odontologo'), Atencion.misCitas);
rutas.post('/citas/:id/atencion', requireRol('odontologo'), Atencion.registrar);

// Tarifario CU-14..17 (el odontólogo puede leerlo para la atención)
const admin = requireRol('administrador');
rutas.get('/tratamientos', requireRol('administrador', 'odontologo'), Inventario.listarTratamientos);
rutas.post('/tratamientos', admin, Inventario.crearTratamiento);
rutas.patch('/tratamientos/:id', admin, Inventario.modificarTratamiento);
rutas.patch('/tratamientos/:id/desactivar', admin, Inventario.desactivarTratamiento);
rutas.patch('/tratamientos/:id/activar', admin, Inventario.activarTratamiento);

// Insumos CU-18..22, kárdex y alertas
rutas.get('/insumos', admin, Inventario.listarInsumos);
rutas.get('/insumos/buscar', admin, Inventario.buscarInsumo);
rutas.post('/insumos', admin, Inventario.crearInsumo);
rutas.patch('/insumos/:id', admin, Inventario.modificarInsumo);
rutas.patch('/insumos/:id/desactivar', admin, Inventario.desactivarInsumo);
rutas.patch('/insumos/:id/activar', admin, Inventario.activarInsumo);
rutas.get('/insumos/:id/kardex', admin, Inventario.kardex);
rutas.get('/alertas', admin, Inventario.alertas);
