// RN-23 Administrador principal: protegido; solo él gestiona a otros administradores; traspaso (CU-59); auditoría de usuarios
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MENSAJES } from '@clinica/shared';
import { app, PASSWORD, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);

/** El principal (Carlos) crea otro administrador y devuelve su id y un agente con su sesión. */
async function otroAdmin() {
  const carlos = await sesion('administrador');
  const r = await carlos.post('/api/usuarios').send({ nombres: 'Probando Admin', email: 'probando@clinica.local', rol: 'administrador', password: 'Segura2026' });
  expect(r.status).toBe(201);
  const agente = request.agent(app);
  await agente.post('/api/auth/login').send({ email: 'probando@clinica.local', password: 'Segura2026' });
  return { id: r.body.id as number, agente, carlos };
}
const idDe = async (email: string) => (await prisma.usuario.findUniqueOrThrow({ where: { email } })).id;

describe('RN-23 Administrador principal', () => {
  it('Carlos Vega es el principal (lo marca la semilla)', async () => {
    const lista = (await (await sesion('administrador')).get('/api/usuarios')).body as { email: string; principal: boolean }[];
    expect(lista.filter((u) => u.principal).map((u) => u.email)).toEqual(['carlos.vega@clinica.local']);
  });

  it('otro administrador no puede desactivar, modificar ni cambiar la contraseña del principal', async () => {
    const { agente } = await otroAdmin();
    const carlos = await idDe('carlos.vega@clinica.local');
    expect((await agente.patch(`/api/usuarios/${carlos}/desactivar`)).body.mensaje).toBe(MENSAJES.PRINCIPAL_PROTEGIDO);
    const r = await agente.patch(`/api/usuarios/${carlos}`).send({ nombres: 'Carlos Vega', email: 'carlos.vega@clinica.local', rol: 'administrador', password: 'Hackeo2026' });
    expect(r.status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ email: 'carlos.vega@clinica.local', password: PASSWORD })).status).toBe(200);
  });

  it('un administrador que no es el principal no crea ni gestiona administradores, pero sí al resto del personal', async () => {
    const { agente } = await otroAdmin();
    expect((await agente.post('/api/usuarios').send({ nombres: 'Otro Admin', email: 'otro@clinica.local', rol: 'administrador', password: 'Segura2026' })).body.mensaje).toBe(MENSAJES.SOLO_PRINCIPAL_ADMINS);
    expect((await agente.post('/api/usuarios').send({ nombres: 'Nueva Recepción', email: 'nueva@clinica.local', rol: 'recepcionista', password: 'Segura2026' })).status).toBe(201);
    const ana = await idDe('ana.rios@clinica.local');
    expect((await agente.patch(`/api/usuarios/${ana}`).send({ nombres: 'Ana Ríos', email: 'ana.rios@clinica.local', rol: 'administrador' })).body.mensaje).toBe(MENSAJES.SOLO_PRINCIPAL_ADMINS);
    expect((await agente.patch(`/api/usuarios/${ana}/desactivar`)).status).toBe(200);
  });

  it('nadie cambia la contraseña de otro administrador, ni el principal', async () => {
    const { id, carlos } = await otroAdmin();
    const r = await carlos.patch(`/api/usuarios/${id}`).send({ nombres: 'Probando Admin', email: 'probando@clinica.local', rol: 'administrador', password: 'Cambiada2026' });
    expect(r.body.mensaje).toBe(MENSAJES.NO_CONTRASENA_ADMIN);
    // a recepcionistas y odontólogos sí (contraseña temporal)
    const ana = await idDe('ana.rios@clinica.local');
    expect((await carlos.patch(`/api/usuarios/${ana}`).send({ nombres: 'Ana Ríos', email: 'ana.rios@clinica.local', rol: 'recepcionista', password: 'Temporal2026' })).status).toBe(200);
  });

  it('el principal sí desactiva a otro administrador; todo queda en la auditoría', async () => {
    const { id, carlos } = await otroAdmin();
    expect((await carlos.patch(`/api/usuarios/${id}/desactivar`)).status).toBe(200);
    const acciones = (await prisma.auditoria.findMany({ orderBy: { id: 'asc' } })).map((a) => `${a.accion}: ${a.detalle}`);
    expect(acciones).toEqual(['crear_usuario: Probando Admin (probando@clinica.local) · Administrador', 'desactivar_usuario: Probando Admin (probando@clinica.local) · Administrador']);
  });

  it('CU-59 traspaso: pide la contraseña del principal; luego el nuevo principal queda protegido', async () => {
    const { id, carlos, agente } = await otroAdmin();
    expect((await agente.post(`/api/usuarios/${id}/principal`).send({ password: 'Segura2026' })).body.mensaje).toBe(MENSAJES.SOLO_PRINCIPAL_TRASPASA);
    expect((await carlos.post(`/api/usuarios/${id}/principal`).send({ password: 'mala' })).body.campos.password).toBe(MENSAJES.CONTRASENA_INCORRECTA);
    const ana = await idDe('ana.rios@clinica.local');
    expect((await carlos.post(`/api/usuarios/${ana}/principal`).send({ password: PASSWORD })).body.mensaje).toBe(MENSAJES.TRASPASO_DESTINO);
    const r = await carlos.post(`/api/usuarios/${id}/principal`).send({ password: PASSWORD });
    expect(r.body).toMatchObject({ id, principal: true });
    expect((await prisma.usuario.findUniqueOrThrow({ where: { email: 'carlos.vega@clinica.local' } })).principal).toBe(false);
    expect((await carlos.patch(`/api/usuarios/${id}/desactivar`)).body.mensaje).toBe(MENSAJES.PRINCIPAL_PROTEGIDO);
    expect((await prisma.auditoria.findFirstOrThrow({ where: { accion: 'traspasar_principal' } })).detalle).toBe('Carlos Vega → Probando Admin (probando@clinica.local)');
  });
});
