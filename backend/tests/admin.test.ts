import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, PASSWORD, prisma, reiniciarBD, sesion, USUARIOS } from './helpers.js';
import { ahoraLima } from '../src/lib/fechas.js';

beforeEach(reiniciarBD);

const idInsumo = async (n: string) => (await prisma.insumo.findUniqueOrThrow({ where: { nombre: n } })).id;
const idUsuario = async (email: string) => (await prisma.usuario.findUniqueOrThrow({ where: { email } })).id;

describe('CU-25 Registrar ajuste de stock', () => {
  it('ajuste positivo y negativo (conteo físico) y merma, con motivo en el kárdex', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Copa de goma'); // 12
    expect((await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'ajuste', cantidad: 3, motivo: 'Conteo físico mensual' })).body.saldo).toBe('15.00');
    expect((await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'ajuste', cantidad: -2, motivo: 'Conteo físico mensual' })).body.saldo).toBe('13.00');
    const m = await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'merma', cantidad: 4, motivo: 'Vencidas (lote 2025)' });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ cantidad: '-4.00', saldo: '9.00', insumo: { stockActual: '9.00' } });
    const k = await admin.get(`/api/insumos/${id}/kardex?tipo=merma`);
    expect(k.body.movimientos).toEqual([expect.objectContaining({ tipo: 'merma', motivo: 'Vencidas (lote 2025)', saldo: '9.00' })]);
  });

  it('rechaza dejar el stock negativo, cantidad 0, merma negativa o sin motivo', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Gel blanqueador'); // 4
    const neg = await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'merma', cantidad: 5, motivo: 'Rotura de jeringas' });
    expect(neg.status).toBe(422);
    expect(neg.body.mensaje).toBe(MENSAJES.AJUSTE_NEGATIVO);
    const v = await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'merma', cantidad: -1, motivo: '' });
    expect(v.body.campos).toMatchObject({ cantidad: 'La merma debe ser una cantidad positiva', motivo: 'Indique el motivo' });
    expect((await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'ajuste', cantidad: 0, motivo: 'Conteo' })).body.campos.cantidad).toBe('La cantidad no puede ser 0');
  });

  it('una merma que deja el stock en el mínimo genera alerta', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Copa de goma'); // 12, mín 5
    expect((await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'merma', cantidad: 7, motivo: 'Material dañado' })).body.alertaGenerada).toBe(true);
  });

  it('RN-13: solo el Administrador registra ajustes', async () => {
    const id = await idInsumo('Copa de goma');
    expect((await (await sesion('odontologo')).post(`/api/insumos/${id}/ajuste`).send({ tipo: 'ajuste', cantidad: 1, motivo: 'Conteo' })).status).toBe(403);
  });
});

describe('CU-23 Consultar kárdex con filtros', () => {
  it('filtra por tipo y por rango de fechas (hora de Lima)', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Copa de goma');
    await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'ajuste', cantidad: 1, motivo: 'Conteo físico' });
    const hoy = ahoraLima().fecha;
    expect((await admin.get(`/api/insumos/${id}/kardex`)).body.movimientos).toHaveLength(2); // inicial + ajuste
    expect((await admin.get(`/api/insumos/${id}/kardex?tipo=ajuste`)).body.movimientos).toHaveLength(1);
    expect((await admin.get(`/api/insumos/${id}/kardex?desde=${hoy}&hasta=${hoy}`)).body.movimientos).toHaveLength(2);
    expect((await admin.get(`/api/insumos/${id}/kardex?desde=2020-01-01&hasta=2020-01-31`)).body.movimientos).toHaveLength(0);
    expect((await admin.get(`/api/insumos/${id}/kardex?tipo=otro`)).status).toBe(422);
  });
});

describe('CU-24 Revisar alertas de stock mínimo', () => {
  it('lista pendientes, marca revisada con quién y cuándo, y deja de aparecer', async () => {
    const admin = await sesion('administrador');
    const id = await idInsumo('Copa de goma');
    await admin.post(`/api/insumos/${id}/ajuste`).send({ tipo: 'merma', cantidad: 8, motivo: 'Material dañado' });
    const pend = await admin.get('/api/alertas');
    const alerta = pend.body.find((a: { insumo: { nombre: string } }) => a.insumo.nombre === 'Copa de goma');
    expect(alerta).toMatchObject({ revisada: false, stockAlGenerar: '4.00' });
    const r = await admin.patch(`/api/alertas/${alerta.id}/revisar`);
    expect(r.body).toMatchObject({ revisada: true, revisadaPor: 'Carlos Vega' });
    expect((await admin.get('/api/alertas')).body.map((a: { id: number }) => a.id)).not.toContain(alerta.id);
    expect((await admin.get('/api/alertas?todas=1')).body.map((a: { id: number }) => a.id)).toContain(alerta.id);
    expect((await admin.patch('/api/alertas/999/revisar')).status).toBe(404);
  });
});

describe('Usuarios CU-34..37', () => {
  it('CU-34 registra recepcionista y odontólogo (con CMP); el nuevo odontólogo aparece para reservar', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/usuarios').send({ nombres: 'Dr. Pablo Ruiz', email: 'pablo.ruiz@clinica.local', rol: 'odontologo', password: 'Clave2026x', cmp: '12345', especialidad: 'Ortodoncia' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ rol: 'odontologo', cmp: '12345', especialidad: 'Ortodoncia', activo: true });
    expect(r.body.password).toBeUndefined();
    const od = await request(app).post('/api/auth/login').send({ email: 'pablo.ruiz@clinica.local', password: 'Clave2026x' });
    expect(od.body.odontologoId).toBeTruthy();
    const lista = await (await sesion('paciente')).get('/api/odontologos');
    expect(lista.body.map((o: { nombres: string }) => o.nombres)).toContain('Dr. Pablo Ruiz');
  });

  it('CU-34 validaciones: correo duplicado (409), contraseña débil y rol inválido (422)', async () => {
    const admin = await sesion('administrador');
    expect((await admin.post('/api/usuarios').send({ nombres: 'Ana Dos', email: USUARIOS.recepcionista, rol: 'recepcionista', password: 'Clave2026x' })).status).toBe(409);
    const r = await admin.post('/api/usuarios').send({ nombres: 'X Y Z', email: 'x@clinica.local', rol: 'paciente', password: 'corta' });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.campos)).toEqual(expect.arrayContaining(['rol', 'password']));
  });

  it('CU-35 lista con filtros por rol y estado', async () => {
    const admin = await sesion('administrador');
    expect((await admin.get('/api/usuarios?rol=odontologo')).body).toHaveLength(2);
    expect((await admin.get('/api/usuarios?q=ana')).body[0].email).toBe(USUARIOS.recepcionista);
  });

  it('CU-36 modifica datos y contraseña; el cambio cierra las sesiones abiertas del usuario', async () => {
    const admin = await sesion('administrador');
    const recep = await sesion('recepcionista');
    const id = await idUsuario(USUARIOS.recepcionista);
    const r = await admin.patch(`/api/usuarios/${id}`).send({ nombres: 'Ana Ríos Vega', email: USUARIOS.recepcionista, rol: 'recepcionista', password: 'NuevaClave1' });
    expect(r.body.nombres).toBe('Ana Ríos Vega');
    expect((await recep.get('/api/auth/yo')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: USUARIOS.recepcionista, password: 'NuevaClave1' })).status).toBe(200);
    // sin contraseña: no la cambia
    await admin.patch(`/api/usuarios/${id}`).send({ nombres: 'Ana Ríos', email: USUARIOS.recepcionista, rol: 'recepcionista', password: '' });
    expect((await request(app).post('/api/auth/login').send({ email: USUARIOS.recepcionista, password: 'NuevaClave1' })).status).toBe(200);
  });

  it('el Administrador no puede quitarse su rol ni desactivarse; no se cambia el rol de odontólogo', async () => {
    const admin = await sesion('administrador');
    const yo = await idUsuario(USUARIOS.administrador);
    const r = await admin.patch(`/api/usuarios/${yo}`).send({ nombres: 'Carlos Vega', email: USUARIOS.administrador, rol: 'recepcionista' });
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toBe(MENSAJES.NO_QUITARSE_ADMIN);
    const d = await admin.patch(`/api/usuarios/${yo}/desactivar`);
    expect(d.status).toBe(422);
    expect(d.body.mensaje).toBe(MENSAJES.NO_DESACTIVARSE);
    const od = await idUsuario(USUARIOS.odontologo);
    const c = await admin.patch(`/api/usuarios/${od}`).send({ nombres: 'Luis', email: USUARIOS.odontologo, rol: 'recepcionista' });
    expect(c.body.mensaje).toBe(MENSAJES.CAMBIO_ROL_ODONTOLOGO);
  });

  it('CU-37 desactivar: cierra su sesión, no puede ingresar y el odontólogo deja de estar disponible', async () => {
    const admin = await sesion('administrador');
    const od = await sesion('odontologo');
    const id = await idUsuario(USUARIOS.odontologo);
    expect((await admin.patch(`/api/usuarios/${id}/desactivar`)).body.activo).toBe(false);
    expect((await od.get('/api/odontologos/me/citas')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: USUARIOS.odontologo, password: PASSWORD })).status).toBe(401);
    const lista = await (await sesion('paciente')).get('/api/odontologos');
    expect(lista.body.map((o: { nombres: string }) => o.nombres)).not.toContain('Dr. Luis Paredes');
    expect((await admin.patch(`/api/usuarios/${id}/activar`)).body.activo).toBe(true);
    expect((await request(app).post('/api/auth/login').send({ email: USUARIOS.odontologo, password: PASSWORD })).status).toBe(200);
  });
});

describe('Campañas de descuento y datos de pago (Administrador)', () => {
  it('crea, modifica y desactiva campañas; la caja ve solo las vigentes hoy', async () => {
    const admin = await sesion('administrador');
    const hoy = ahoraLima().fecha;
    const consulta = (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: 'Consulta' } })).id;
    const r = await admin.post('/api/admin/descuentos').send({ nombre: 'Consulta a mitad', porcentaje: 50, fechaInicio: hoy, fechaFin: hoy, tratamientos: [consulta] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ nombre: 'Consulta a mitad', tipo: 'porcentaje', porcentaje: '50.00', fechaInicio: hoy, tratamientos: [{ nombre: 'Consulta' }] });
    const futura = await admin.post('/api/admin/descuentos').send({ nombre: 'Futura', porcentaje: 10, fechaInicio: '2099-01-01', fechaFin: '2099-01-31', tratamientos: [consulta] });
    expect(futura.status).toBe(201);
    const caja = await (await sesion('recepcionista')).get('/api/caja/campanas');
    expect(caja.body.map((c: { nombre: string }) => c.nombre)).toEqual(['Consulta a mitad']);
    expect((await admin.patch(`/api/admin/descuentos/${r.body.id}`).send({ nombre: 'Consulta 40 %', porcentaje: 40, fechaInicio: hoy, fechaFin: hoy, tratamientos: [consulta] })).body.porcentaje).toBe('40.00');
    expect((await admin.patch(`/api/admin/descuentos/${r.body.id}/desactivar`)).body.activo).toBe(false);
  });

  it('valida: porcentaje en (0, 100], fechas en orden, al menos un tratamiento; 3x2 sin porcentaje', async () => {
    const admin = await sesion('administrador');
    const r = await admin.post('/api/admin/descuentos').send({ nombre: 'Mal', porcentaje: 150, fechaInicio: '2026-07-31', fechaFin: '2026-07-01', tratamientos: [] });
    expect(r.status).toBe(422);
    expect(r.body.campos).toMatchObject({ porcentaje: 'Máximo 100 %', tratamientos: 'Elija al menos un tratamiento' });
    const resina = (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre: 'Curación con resina' } })).id;
    const tres = await admin.post('/api/admin/descuentos').send({ nombre: 'Resinas 3x2', tipo: 'tres_por_dos', fechaInicio: '2026-07-01', fechaFin: '2026-07-31', tratamientos: [resina] });
    expect(tres.body).toMatchObject({ tipo: 'tres_por_dos', porcentaje: null });
  });

  it('datos de Yape/Plin para el adelanto', async () => {
    const admin = await sesion('administrador');
    expect((await admin.get('/api/admin/pago')).body).toEqual({ numero: '987654321', titular: 'Clínica Dental (ficticio)', billeteras: ['yape'], tieneQr: false, saldoVigenciaMeses: 12 });
    expect((await admin.put('/api/admin/pago').send({ numero: '912345678', titular: 'Clínica Dental SAC', billeteras: ['yape'] })).body.numero).toBe('912345678');
    expect((await admin.put('/api/admin/pago').send({ numero: '12345', titular: 'X' })).status).toBe(422);
  });
});
