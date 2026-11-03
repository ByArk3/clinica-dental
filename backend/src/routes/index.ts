import { Router } from 'express';
import * as Auth from '../controllers/auth.controller.js';
import * as Pacientes from '../controllers/paciente.controller.js';
import * as Citas from '../controllers/cita.controller.js';
import { requireAuth, requireRol } from '../middlewares/auth.js';

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
