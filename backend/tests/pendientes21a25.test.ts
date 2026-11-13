// Pendientes 21–25: apoderado en 3 campos, «Mis datos», celular que empieza con 9, texto libre y dientes de leche
import { beforeEach, describe, expect, it } from 'vitest';
import { moverFecha, hoyEnLima, nombrePieza, problemaTextoLibre } from '@clinica/shared';
import { crearCita, idTratamiento, prisma, reiniciarBD, sesion } from './helpers.js';

beforeEach(reiniciarBD);
const hace = (anios: number) => moverFecha(hoyEnLima(), { anios: -anios });

describe('Apoderado y «Mis datos»', () => {
  it('celular: debe empezar con 9 (paciente y apoderado)', async () => {
    const recep = await sesion('recepcionista');
    const base = { dni: '45678914', nombres: 'Luis', apellidos: 'Polo', fechaNacimiento: hace(8), sexo: 'masculino', apoderado: 'Ana Polo', apoderadoDni: '40000001' };
    const r = await recep.post('/api/pacientes').send({ ...base, telefono: '232323212', apoderadoTelefono: '123456789' });
    expect(r.body.campos).toMatchObject({ telefono: 'El celular debe empezar con 9', apoderadoTelefono: 'El celular debe empezar con 9 y tener 9 dígitos' });
    const ok = await recep.post('/api/pacientes').send({ ...base, telefono: '912345678', apoderadoTelefono: '987000001' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ apoderado: 'Ana Polo', apoderadoDni: '40000001', apoderadoTelefono: '987000001' });
  });

  it('el nombre del apoderado lleva solo letras; alergias y antecedentes con palabras', async () => {
    const recep = await sesion('recepcionista');
    const r = await recep.post('/api/pacientes').send({
      dni: '45678915', nombres: 'Ana', apellidos: 'Ruiz', fechaNacimiento: hace(9), sexo: 'femenino', telefono: '912345678',
      apoderado: 'sdsd2323', apoderadoDni: '40000003', apoderadoTelefono: '987000003', alergias: 'sdsa2323131sadas1313131', antecedentes: '12345',
    });
    expect(r.body.campos).toMatchObject({
      apoderado: 'El nombre del apoderado lleva solo letras',
      alergias: 'Revise el texto: separe las palabras de los números (ej.: «500 mg»)',
      antecedentes: 'Escriba con palabras (al menos 3 letras)',
    });
  });

  it('«Mis datos»: el correo es obligatorio; un adulto no cambia el apoderado; un menor no puede quedarse sin él', async () => {
    const pac = await sesion('paciente');
    expect((await pac.patch('/api/pacientes/me').send({ telefono: '912345678', email: '' })).body.campos.email).toBe('Ingrese su correo');
    // María es adulta: lo que mande de apoderado se ignora
    const r = await pac.patch('/api/pacientes/me').send({ telefono: '912345678', email: 'maria.quispe@correo.local', apoderado: 'Alguien' });
    expect(r.status).toBe(200);
    expect(r.body.apoderado).toBeNull();
    // si fuera menor, no puede borrar a su apoderado
    const yo = await prisma.paciente.findFirstOrThrow({ where: { email: 'maria.quispe@correo.local' } });
    await prisma.paciente.update({ where: { id: yo.id }, data: { fechaNacimiento: new Date(`${hace(10)}T00:00:00Z`), apoderado: 'Rosa Quispe', apoderadoDni: '40000004', apoderadoTelefono: '987000004' } });
    const sin = await pac.patch('/api/pacientes/me').send({ telefono: '912345678', email: 'maria.quispe@correo.local', apoderado: '', apoderadoDni: '', apoderadoTelefono: '' });
    expect(sin.status).toBe(422);
    expect(sin.body.campos).toMatchObject({ apoderado: 'Ingrese el nombre del apoderado', apoderadoDni: 'Ingrese el DNI del apoderado' });
  });

  it('cambiar el correo en «Mis datos» cambia también el usuario de la web', async () => {
    const pac = await sesion('paciente');
    expect((await pac.patch('/api/pacientes/me').send({ telefono: '912345678', email: 'maria.nueva@correo.local' })).status).toBe(200);
    expect(await prisma.usuario.findUnique({ where: { email: 'maria.nueva@correo.local' } })).not.toBeNull();
  });
});

describe('Texto libre y odontograma', () => {
  it('regla del texto libre', () => {
    expect(problemaTextoLibre('Penicilina 500 mg')).toBeNull();
    expect(problemaTextoLibre('Caries en pieza 36, profunda')).toBeNull();
    expect(problemaTextoLibre('')).toBeNull();
    expect(problemaTextoLibre('sdsdsd2323dsdsdssdsddsds232312313')).toMatch(/separe/);
    expect(problemaTextoLibre('12345')).toMatch(/3 letras/);
    expect(problemaTextoLibre('dolor <script>')).toMatch(/Use solo/);
  });

  it('diagnóstico con basura → 422; dientes de leche (54) aceptados', async () => {
    const c = await crearCita({ horas: -1, estado: 'confirmada' });
    const od = await sesion('odontologo');
    const consulta = await idTratamiento('Consulta');
    const mal = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'sdsdsd2323dsdsdss', tratamientos: [{ tratamientoId: consulta }] });
    expect(mal.body.campos.diagnostico).toMatch(/separe/);
    const ok = await od.post(`/api/citas/${c.id}/atencion`).send({ diagnostico: 'Caries en molar de leche', tratamientos: [{ tratamientoId: consulta, piezaDental: '54' }] });
    expect(ok.status).toBe(201);
  });

  it('nombre de cada pieza (FDI)', () => {
    expect(nombrePieza('36')).toBe('primer molar inferior izquierdo');
    expect(nombrePieza('11')).toBe('incisivo central superior derecho');
    expect(nombrePieza('18')).toBe('tercer molar superior derecho (muela del juicio)');
    expect(nombrePieza('54')).toBe('primer molar de leche superior derecho');
    expect(nombrePieza('71')).toBe('incisivo central de leche inferior izquierdo');
  });
});
