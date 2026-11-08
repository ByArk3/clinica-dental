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

// CU-01 Iniciar sesión (RN-21 bloqueo, RN-22 auditoría) / CU-02 Recuperar contraseña / CU-03 Registrar paciente (web)
rutas.post('/auth/login', Auth.login);
rutas.post('/auth/logout', Auth.logout);
rutas.get('/auth/yo', requireAuth, Auth.yo);
rutas.post('/auth/recuperar', Auth.recuperar); // límite: 3 cada 15 min por IP y por correo
rutas.post('/auth/restablecer', Auth.restablecer);
rutas.post('/auth/registro-paciente', Auth.registroPaciente);

// CU-03 (presencial) y búsqueda por DNI (CU-06 presencial)
rutas.post('/pacientes', requireRol('recepcionista'), Pacientes.registrar);
rutas.get('/pacientes', requireRol('recepcionista'), Pacientes.buscarPorDni);
rutas.get('/reniec/:dni', requireRol('recepcionista'), Pacientes.reniec); // CU-57 «extend» de CU-03 (opcional)
// Paciente sin DNI a la mano (presencial): queda «DNI pendiente» y se completa después. Búsqueda por nombre sin datos clínicos.
rutas.get('/pacientes/por-nombre', requireRol('recepcionista'), Pacientes.buscarPorNombre);
rutas.post('/pacientes/sin-dni', requireRol('recepcionista'), Pacientes.registrarSinDni);
rutas.get('/pacientes/sin-dni', requireRol('recepcionista', 'administrador'), Pacientes.listarSinDni);
// Buscar cita: las citas (próximas y anteriores) de un paciente, sin datos clínicos (RN-07)
rutas.get('/pacientes/:id/citas', requireRol('recepcionista'), Citas.delPaciente);

// CU-10 Historial clínico — RN-07: solo Odontólogo y Administrador; cada acceso queda en la auditoría (RN-22)
const soloClinico = requireRolConMensaje(MENSAJES.SIN_PERMISO_HISTORIAL, 'odontologo', 'administrador');
rutas.get('/pacientes/buscar', soloClinico, Atencion.buscarPacientes);
rutas.get('/pacientes/:id/historial', soloClinico, Atencion.historial);

// CU-04 Actualizar datos de contacto
rutas.get('/pacientes/me', requireRol('paciente'), Pacientes.miPerfil); // también CU-56 Consultar saldo a favor (RN-17)
rutas.patch('/pacientes/me', requireRol('paciente'), Pacientes.actualizarMiContacto);
rutas.patch('/pacientes/:id/contacto', requireRol('recepcionista'), Pacientes.actualizarContacto);
// CU-58 Corregir datos del paciente («extend» de CU-04): identidad con motivo y auditoría (RN-22); DNI solo lo cambia el Administrador
rutas.put('/pacientes/:id/dni', requireRol('recepcionista', 'administrador'), Pacientes.guardarDni);

// CU-05 Consultar disponibilidad (RN-03) / CU-06 Registrar cita (RN-12 adelanto, RN-17 saldo primero)
rutas.get('/odontologos', requireAuth, Citas.odontologos);
rutas.get('/disponibilidad', requireRol('paciente', 'recepcionista'), Citas.disponibilidad);
rutas.post('/citas', requireRol('paciente', 'recepcionista'), Citas.registrar);
rutas.get('/citas/mias', requireRol('paciente'), Citas.mias);

// CU-08 Recordar cita (público, con el token del recordatorio). /citas/confirmar/ se mantiene por los enlaces ya enviados.
for (const base of ['/citas/recordatorio', '/citas/confirmar']) {
  rutas.get(`${base}/:token`, Citas.verConfirmacion);
  rutas.post(`${base}/:token`, Citas.responderConfirmacion);
}

// CU-07 Reprogramar o cancelar cita («extend» de CU-08; RN-16 para el adelanto)
rutas.patch('/citas/:id/reprogramar', requireRol('paciente', 'recepcionista'), Citas.reprogramar);
rutas.patch('/citas/:id/cancelar', requireRol('paciente', 'recepcionista'), Citas.cancelar);
rutas.patch('/citas/:id/datos', requireRol('recepcionista'), Citas.editarDatos); // motivo y tratamiento previsto (sin adelanto pagado)
// CU-41 Pagar adelanto («extend» de CU-06): el paciente reporta su pago por Yape/Plin (captura opcional, hasta 2 MB; RN-18)
rutas.post('/citas/:id/pago', express.json({ limit: '3mb' }), requireRol('paciente'), Citas.reportarPago);
rutas.get('/tarifario', requireRol('paciente', 'recepcionista'), Citas.tarifarioPublico);
rutas.get('/datos-pago', requireRol('paciente', 'recepcionista', 'administrador'), Citas.datosPago);
rutas.get('/datos-pago/qr', requireRol('paciente', 'recepcionista', 'administrador'), Citas.qrPago);

// CU-09 Citas del día e inasistencias (el adelanto se pierde, RN-16)
rutas.get('/citas', requireRol('recepcionista'), Citas.delDia);
rutas.post('/citas/:id/inasistencia', requireRol('recepcionista'), Citas.inasistencia);

// CU-11 Registrar atención — RN-06: solo el odontólogo
rutas.get('/odontologos/me/citas', requireRol('odontologo'), Atencion.misCitas);
rutas.post('/citas/:id/atencion', requireRol('odontologo'), Atencion.registrar);
// CU-44 Corregir atención («extend» de CU-10; RN-20)
rutas.get('/atenciones/:id', requireRol('odontologo'), Atencion.verParaEditar);
rutas.patch('/atenciones/:id', requireRol('odontologo'), Atencion.editar);

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
rutas.patch('/alertas/:id/reabrir', admin, Admin.reabrirAlerta); // CU-24 «Volver a pendiente» (RN-22)

// CU-13 Emitir comprobante (Caja) — Recepcionista. RN-10 campañas, RN-16/RN-17 adelanto y saldo
const recep = requireRol('recepcionista');
rutas.get('/caja/pendientes', recep, Caja.pendientes);
rutas.get('/caja/citas/:id/importe', recep, Caja.importe);
rutas.post('/caja/citas/:id/comprobante', recep, Caja.emitir);
rutas.get('/tipos-pago', recep, Caja.tiposPago);
rutas.get('/caja/campanas', recep, Caja.campanas);
// CU-42 Verificar pago de adelanto (RN-18)
rutas.post('/caja/citas/:id/aprobar-pago', recep, Caja.aprobarPago);
rutas.post('/caja/citas/:id/rechazar-pago', recep, Caja.rechazarPago);
rutas.get('/caja/citas/:id/captura', recep, Caja.captura);
rutas.get('/comprobantes/:id', requireRol('recepcionista', 'administrador'), Caja.ver);
rutas.get('/comprobantes/:id/pdf', requireRol('recepcionista', 'administrador'), Caja.pdf);
rutas.post('/comprobantes/:id/enviar', recep, Caja.enviar);
rutas.get('/caja/comprobantes', recep, Caja.delDia);
rutas.patch('/comprobantes/:id/anular', requireRol('recepcionista', 'administrador'), Caja.anular); // CU-43 Anular comprobante (RN-19)

// ===== Iteración 4 (Administrador) =====
// Proveedores CU-26..29
rutas.get('/proveedores', admin, Admin.listarProveedores);
rutas.get('/sunat/:ruc', admin, Admin.sunat); // CU-57 «extend» de CU-26 (opcional)
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
rutas.patch('/usuarios/:id/desbloquear', admin, Admin.desbloquearUsuario); // CU-46 «extend» de CU-35 (RN-21)
// RN-23 Administrador principal: solo él gestiona a otros administradores y nadie lo modifica ni desactiva
rutas.post('/usuarios/:id/principal', admin, Admin.traspasarPrincipal); // CU-59 «extend» de CU-35
// CU-45 Consultar auditoría (RN-22: accesos al historial, correcciones, anulaciones y bloqueos)
rutas.get('/admin/auditoria', admin, Admin.auditoria);

// CU-47 Registrar · CU-48 Listar · CU-49 Modificar · CU-50 Desactivar campaña de descuento (RN-10)
rutas.get('/admin/descuentos', admin, Admin.listarDescuentos);
rutas.post('/admin/descuentos', admin, Admin.crearDescuento);
rutas.patch('/admin/descuentos/:id', admin, Admin.modificarDescuento);
rutas.patch('/admin/descuentos/:id/desactivar', admin, Admin.desactivarDescuento);
rutas.patch('/admin/descuentos/:id/activar', admin, Admin.activarDescuento);
// CU-55 Configurar datos de pago (billeteras, número, QR, vigencia del saldo — RN-17, RN-18)
rutas.get('/admin/pago', admin, Admin.verDatosPago);
rutas.put('/admin/pago', admin, Admin.guardarDatosPago);
rutas.put('/admin/pago/qr', express.json({ limit: '3mb' }), admin, Admin.guardarQrPago);
rutas.delete('/admin/pago/qr', admin, Admin.quitarQrPago);
// CU-51 Registrar · CU-52 Listar · CU-53 Eliminar feriado (RN-03)
rutas.get('/admin/feriados', admin, Admin.listarFeriados);
rutas.post('/admin/feriados', admin, Admin.crearFeriado);
rutas.delete('/admin/feriados/:id', admin, Admin.eliminarFeriado);
// CU-54 Configurar horario del odontólogo (RN-03)
rutas.get('/admin/odontologos/:id/horario', admin, Admin.verHorario);
rutas.put('/admin/odontologos/:id/horario', admin, Admin.guardarHorario);

// CU-38 Panel (adelantos por pagar) · CU-39 Ingresos (sin anulados, menos devoluciones) · CU-40 Inventario
rutas.get('/panel', admin, Admin.panel);
rutas.get('/reportes/ingresos', admin, Admin.reporteIngresos);
rutas.get('/reportes/inventario', admin, Admin.reporteInventario);

// CU-58: al final, para que /pacientes/me, /pacientes/buscar, /pacientes/por-nombre y /pacientes/sin-dni tengan prioridad
rutas.get('/pacientes/:id', requireRol('recepcionista', 'administrador'), Pacientes.ver);
rutas.patch('/pacientes/:id', requireRol('recepcionista', 'administrador'), Pacientes.editar);
