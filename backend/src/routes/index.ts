import express, { Router } from 'express';
import * as Auth from '../controllers/auth.controller.js';
import * as Pacientes from '../controllers/paciente.controller.js';
import * as Citas from '../controllers/cita.controller.js';
import * as Inventario from '../controllers/inventario.controller.js';
import * as Atencion from '../controllers/atencion.controller.js';
import * as Caja from '../controllers/caja.controller.js';
import * as Admin from '../controllers/admin.controller.js';
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
// Adelanto: el paciente reporta su pago por Yape/Plin (con captura opcional, hasta 2 MB)
rutas.post('/citas/:id/pago', express.json({ limit: '3mb' }), requireRol('paciente'), Citas.reportarPago);
rutas.get('/tarifario', requireRol('paciente', 'recepcionista'), Citas.tarifarioPublico);
rutas.get('/datos-pago', requireRol('paciente', 'recepcionista'), Citas.datosPago);

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
rutas.get('/insumos/:id/kardex', admin, Admin.kardex); // CU-23
rutas.post('/insumos/:id/ajuste', admin, Admin.ajuste); // CU-25 (RN-13)
rutas.get('/alertas', admin, Admin.alertas); // CU-24
rutas.patch('/alertas/:id/revisar', admin, Admin.revisarAlerta);

// CU-13 Caja — Recepcionista
const recep = requireRol('recepcionista');
rutas.get('/caja/pendientes', recep, Caja.pendientes);
rutas.get('/caja/citas/:id/importe', recep, Caja.importe);
rutas.post('/caja/citas/:id/comprobante', recep, Caja.emitir);
rutas.get('/tipos-pago', recep, Caja.tiposPago);
rutas.get('/caja/campanas', recep, Caja.campanas);
rutas.post('/caja/citas/:id/aprobar-pago', recep, Caja.aprobarPago);
rutas.post('/caja/citas/:id/rechazar-pago', recep, Caja.rechazarPago);
rutas.get('/caja/citas/:id/captura', recep, Caja.captura);
rutas.get('/comprobantes/:id', requireRol('recepcionista', 'administrador'), Caja.ver);
rutas.get('/comprobantes/:id/pdf', requireRol('recepcionista', 'administrador'), Caja.pdf);
rutas.post('/comprobantes/:id/enviar', recep, Caja.enviar);

// ===== Iteración 4 (Administrador) =====
// Proveedores CU-26..29
rutas.get('/proveedores', admin, Admin.listarProveedores);
rutas.post('/proveedores', admin, Admin.crearProveedor);
rutas.patch('/proveedores/:id', admin, Admin.modificarProveedor);
rutas.patch('/proveedores/:id/desactivar', admin, Admin.desactivarProveedor);
rutas.patch('/proveedores/:id/activar', admin, Admin.activarProveedor);

// Pedidos CU-30..33 (RN-13: solo el Administrador)
rutas.get('/pedidos', admin, Admin.listarPedidos);
rutas.post('/pedidos', admin, Admin.registrarPedido);
rutas.get('/pedidos/:id', admin, Admin.verPedido);
rutas.get('/pedidos/:id/pdf', admin, Admin.pdfDePedido);
rutas.post('/pedidos/:id/enviar', admin, Admin.enviarPedido);
rutas.patch('/pedidos/:id/anular', admin, Admin.anularPedido);
rutas.post('/pedidos/:id/recepcion', admin, Admin.recepcion);

// Usuarios CU-34..37
rutas.get('/usuarios', admin, Admin.listarUsuarios);
rutas.post('/usuarios', admin, Admin.crearUsuario);
rutas.patch('/usuarios/:id', admin, Admin.modificarUsuario);
rutas.patch('/usuarios/:id/desactivar', admin, Admin.desactivarUsuario);
rutas.patch('/usuarios/:id/activar', admin, Admin.activarUsuario);

// Descuentos (P3) y monto del adelanto (P6)
rutas.get('/admin/descuentos', admin, Admin.listarDescuentos);
rutas.post('/admin/descuentos', admin, Admin.crearDescuento);
rutas.patch('/admin/descuentos/:id', admin, Admin.modificarDescuento);
rutas.patch('/admin/descuentos/:id/desactivar', admin, Admin.desactivarDescuento);
rutas.patch('/admin/descuentos/:id/activar', admin, Admin.activarDescuento);
rutas.get('/admin/pago', admin, Admin.verDatosPago);
rutas.put('/admin/pago', admin, Admin.guardarDatosPago);
// Feriados y horario de cada odontólogo
rutas.get('/admin/feriados', admin, Admin.listarFeriados);
rutas.post('/admin/feriados', admin, Admin.crearFeriado);
rutas.delete('/admin/feriados/:id', admin, Admin.eliminarFeriado);
rutas.get('/admin/odontologos/:id/horario', admin, Admin.verHorario);
rutas.put('/admin/odontologos/:id/horario', admin, Admin.guardarHorario);

// CU-38..40 Panel y reportes
rutas.get('/panel', admin, Admin.panel);
rutas.get('/reportes/ingresos', admin, Admin.reporteIngresos);
rutas.get('/reportes/inventario', admin, Admin.reporteInventario);
