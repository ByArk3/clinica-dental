// Límite de 3 intentos al iniciar sesión (bloqueo de 15 min) y registro de auditoría del historial clínico
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, idPaciente, PASSWORD, prisma, reiniciarBD, sesion, USUARIOS } from './helpers.js';
import { solicitarRecuperacion } from '../src/services/auth.service.js';

beforeEach(reiniciarBD);

const entrar = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });

describe('Límite de intentos al iniciar sesión', () => {
  it('avisa los intentos que quedan y al 3.º bloquea 15 min, aunque luego la contraseña sea correcta', async () => {
    const email = USUARIOS.recepcionista;
    expect((await entrar(email, 'mala1')).body.mensaje).toBe(`${MENSAJES.CREDENCIALES_INVALIDAS}. Le quedan 2 intentos`);
    expect((await entrar(email, 'mala2')).body.mensaje).toBe(`${MENSAJES.CREDENCIALES_INVALIDAS}. Le queda 1 intento`);
    const tercero = await entrar(email, 'mala3');
    expect(tercero.status).toBe(423);
    expect(tercero.body.codigo).toBe('CUENTA_BLOQUEADA');
    expect(tercero.body.mensaje).toMatch(new RegExp(`^${MENSAJES.CUENTA_BLOQUEADA}\\. Intente de nuevo a las \\d{2}:\\d{2}$`));
    const correcta = await entrar(email, PASSWORD);
    expect(correcta.status).toBe(423);
    const fila = await prisma.intentoLogin.findUniqueOrThrow({ where: { email } });
    const minutos = (fila.bloqueadoHasta!.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThanOrEqual(15);
    // queda en la auditoría
    const a = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'bloqueo_login' } });
    expect(a.usuarioId).toBe((await prisma.usuario.findUniqueOrThrow({ where: { email } })).id);
  });

  it('pasados los 15 min puede volver a ingresar y el contador vuelve a 0', async () => {
    const email = USUARIOS.paciente;
    for (const p of ['a', 'b', 'c']) await entrar(email, p);
    await prisma.intentoLogin.update({ where: { email }, data: { bloqueadoHasta: new Date(Date.now() - 1000) } });
    // un fallo después del bloqueo vencido empieza de nuevo en 1
    expect((await entrar(email, 'x')).body.mensaje).toContain('Le quedan 2 intentos');
    expect((await entrar(email, PASSWORD)).status).toBe(200);
    expect(await prisma.intentoLogin.count({ where: { email } })).toBe(0);
  });

  it('un ingreso correcto antes del 3.º fallo reinicia el contador', async () => {
    const email = USUARIOS.odontologo;
    await entrar(email, 'a');
    await entrar(email, 'b');
    expect((await entrar(email, PASSWORD)).status).toBe(200);
    expect((await entrar(email, 'c')).body.mensaje).toContain('Le quedan 2 intentos');
  });

  it('con un correo que no existe responde igual (no revela qué cuentas existen)', async () => {
    const real = await entrar(USUARIOS.administrador, 'mala');
    const falso = await entrar('nadie@correo.local', 'mala');
    expect(falso.status).toBe(real.status);
    expect(falso.body).toEqual(real.body);
    await entrar('nadie@correo.local', 'mala');
    expect((await entrar('nadie@correo.local', 'mala')).status).toBe(423);
  });

  it('el correo no distingue mayúsculas: no se evita el bloqueo cambiándolas', async () => {
    await entrar('Ana.Rios@clinica.local', 'a');
    await entrar('ANA.RIOS@CLINICA.LOCAL', 'b');
    expect((await entrar(USUARIOS.recepcionista, 'c')).status).toBe(423);
  });

  it('intentos simultáneos se cuentan todos', async () => {
    const r = await Promise.all([1, 2, 3, 4].map(() => entrar(USUARIOS.recepcionista, 'mala')));
    expect(r.filter((x) => x.status === 423).length).toBeGreaterThanOrEqual(1);
    expect(r.filter((x) => x.status === 401).length).toBeLessThanOrEqual(2); // nunca más de 2 avisos antes del bloqueo
    expect((await entrar(USUARIOS.recepcionista, PASSWORD)).status).toBe(423);
  });

  it('el Administrador ve el bloqueo en Usuarios y desbloquea la cuenta', async () => {
    for (const p of ['a', 'b', 'c']) await entrar(USUARIOS.recepcionista, p);
    const admin = await sesion('administrador');
    const lista = await admin.get('/api/usuarios');
    const ana = lista.body.find((u: { email: string }) => u.email === USUARIOS.recepcionista);
    expect(ana.bloqueadoHasta).toEqual(expect.any(String));
    expect(lista.body.find((u: { email: string }) => u.email === USUARIOS.odontologo).bloqueadoHasta).toBeNull();
    expect((await admin.patch(`/api/usuarios/${ana.id}/desbloquear`)).status).toBe(200);
    expect((await entrar(USUARIOS.recepcionista, PASSWORD)).status).toBe(200);
    expect(await prisma.auditoria.count({ where: { accion: 'desbloqueo_login' } })).toBe(1);
    // RNF07: la recepcionista no puede desbloquear
    const recep = await sesion('recepcionista');
    expect((await recep.patch(`/api/usuarios/${ana.id}/desbloquear`)).status).toBe(403);
  });

  it('al restablecer la contraseña se quita el bloqueo', async () => {
    for (const p of ['a', 'b', 'c']) await entrar(USUARIOS.paciente, p);
    const token = await solicitarRecuperacion(USUARIOS.paciente);
    await request(app).post('/api/auth/restablecer').send({ token, password: 'NuevaClave99' });
    expect((await entrar(USUARIOS.paciente, 'NuevaClave99')).status).toBe(200);
  });
});

describe('Auditoría de accesos al historial clínico', () => {
  it('cada vez que se abre la ficha queda quién, con qué rol, de qué paciente y cuándo', async () => {
    const pacienteId = await idPaciente('72458190');
    const od = await sesion('odontologo');
    expect((await od.get(`/api/pacientes/${pacienteId}/historial`)).status).toBe(200);
    const admin = await sesion('administrador');
    await admin.get(`/api/pacientes/${pacienteId}/historial`);
    await admin.get(`/api/pacientes/${await idPaciente('70112233')}/historial`);

    const r = await admin.get('/api/admin/auditoria?dni=72458190');
    expect(r.status).toBe(200);
    expect(r.body.eventos).toHaveLength(2);
    expect(r.body.eventos[0]).toMatchObject({ accion: 'ver_historial', usuario: { nombres: 'Carlos Vega', rol: 'administrador' }, paciente: { dni: '72458190' } });
    expect(r.body.eventos[1]).toMatchObject({ usuario: { email: USUARIOS.odontologo, rol: 'odontologo' } });
    expect(Math.abs(new Date(r.body.eventos[1].fecha).getTime() - Date.now())).toBeLessThan(60_000);

    const porUsuario = await admin.get(`/api/admin/auditoria?usuarioId=${r.body.eventos[0].usuario.id}&accion=ver_historial`);
    expect(porUsuario.body.eventos).toHaveLength(2);
  });

  it('un acceso denegado (recepcionista, RN-07) no muestra la ficha ni se registra como visto', async () => {
    const recep = await sesion('recepcionista');
    expect((await recep.get(`/api/pacientes/${await idPaciente('72458190')}/historial`)).status).toBe(403);
    expect(await prisma.auditoria.count()).toBe(0);
  });

  it('filtra por rango de fechas y valida los filtros; solo el Administrador la consulta', async () => {
    const admin = await sesion('administrador');
    await admin.get(`/api/pacientes/${await idPaciente('72458190')}/historial`);
    expect((await admin.get('/api/admin/auditoria?desde=2020-01-01&hasta=2020-01-31')).body.eventos).toHaveLength(0);
    expect((await admin.get('/api/admin/auditoria?dni=123')).status).toBe(422);
    expect((await admin.get('/api/admin/auditoria?accion=borrar')).status).toBe(422);
    expect((await (await sesion('odontologo')).get('/api/admin/auditoria')).status).toBe(403);
  });
});
