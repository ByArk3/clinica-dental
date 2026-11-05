// Seguridad: secreto de sesión, HTML escapado en correos y límite de «recuperar contraseña»
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma, reiniciarBD, sesion } from './helpers.js';
import { secretoDeSesion } from '../src/lib/config.js';
import { escaparHtml } from '../src/lib/html.js';
import { bandejaDePrueba } from '../src/lib/correo.js';
import { solicitarRecuperacion } from '../src/services/auth.service.js';

beforeEach(async () => {
  await reiniciarBD();
  bandejaDePrueba.length = 0;
});

describe('SESSION_SECRET', () => {
  it('en producción no arranca sin secreto, con uno corto o con un valor de ejemplo', () => {
    for (const SESSION_SECRET of [undefined, 'corto', 'cambie-este-secreto-en-produccion', 'solo-desarrollo']) {
      expect(() => secretoDeSesion({ NODE_ENV: 'production', SESSION_SECRET })).toThrow(/SESSION_SECRET no es seguro/);
    }
    const bueno = 'a'.repeat(64);
    expect(secretoDeSesion({ NODE_ENV: 'production', SESSION_SECRET: bueno })).toBe(bueno);
  });

  it('en desarrollo y pruebas usa uno de desarrollo si falta', () => {
    expect(secretoDeSesion({ NODE_ENV: 'test' })).toBe('solo-desarrollo');
  });
});

describe('Correos: los datos del usuario se escapan', () => {
  it('escaparHtml', () => {
    expect(escaparHtml('<b>Ana</b> & "Co"')).toBe('&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Co&quot;');
  });

  it('un paciente llamado «<b>Ana</b>» recibe el correo con el nombre como texto, no como HTML', async () => {
    const r = await request(app).post('/api/auth/registro-paciente').send({
      dni: '45678912', nombres: '<b>Ana</b>', apellidos: 'Prueba', fechaNacimiento: '1990-01-01', telefono: '987654321', email: 'ana.prueba@correo.local', password: 'Clinica2026',
    });
    expect(r.status).toBe(201);
    await solicitarRecuperacion('ana.prueba@correo.local');
    const correo = bandejaDePrueba.find((c) => c.para === 'ana.prueba@correo.local')!;
    expect(correo.html).toContain('Hola &lt;b&gt;Ana&lt;/b&gt; Prueba:');
    expect(correo.html).not.toContain('<b>Ana</b>');
  });

  it('el motivo del rechazo de un pago también se escapa', async () => {
    const pac = await prisma.paciente.findUniqueOrThrow({ where: { dni: '72458190' } });
    const c = await prisma.cita.create({
      data: { pacienteId: pac.id, odontologoId: (await prisma.odontologo.findFirstOrThrow()).id, fecha: new Date(Date.now() + 5 * 86_400_000), hora: new Date('1970-01-01T09:00:00Z'), motivo: 'x', canal: 'web', estado: 'pago_en_verificacion', montoAdelanto: 20, pagoOperacion: '123456', creadoPorId: (await prisma.usuario.findFirstOrThrow()).id },
    });
    await (await sesion('recepcionista')).post(`/api/caja/citas/${c.id}/rechazar-pago`).send({ motivo: 'No llegó <script>alert(1)</script>' });
    const correo = bandejaDePrueba.at(-1)!;
    expect(correo.html).toContain('&lt;script&gt;');
    expect(correo.html).not.toContain('<script>');
  });
});

describe('Límite de «Recuperar contraseña»', () => {
  it('por IP: 3 solicitudes cada 15 min; la 4.ª → 429 (sin revelar si el correo existe)', async () => {
    for (let i = 0; i < 3; i++) expect((await request(app).post('/api/auth/recuperar').send({ email: `nadie${i}@correo.local` })).status).toBe(200);
    const r = await request(app).post('/api/auth/recuperar').send({ email: 'maria.quispe@correo.local' });
    expect(r.status).toBe(429);
    expect(r.body.codigo).toBe('DEMASIADAS_SOLICITUDES');
  });

  it('por correo: más de 3 en 15 min no envía más correos, y la respuesta es la misma', async () => {
    for (let i = 0; i < 3; i++) expect(await solicitarRecuperacion('maria.quispe@correo.local')).toEqual(expect.any(String));
    expect(await solicitarRecuperacion('maria.quispe@correo.local')).toBeUndefined();
    expect(bandejaDePrueba.filter((c) => c.para === 'maria.quispe@correo.local')).toHaveLength(3);
  });
});
