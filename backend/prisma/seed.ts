// Datos semilla (sección 13 del brief). TODOS LOS DATOS SON FICTICIOS.
// Contraseña de todos los usuarios de prueba: Clinica2026
import { PrismaClient, type Rol } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

export const PASSWORD = 'Clinica2026';
const t = (h: string) => new Date(`1970-01-01T${h}:00Z`);
const d = (f: string) => new Date(`${f}T00:00:00Z`);

async function usuario(prisma: PrismaClient, nombres: string, email: string, rol: Rol, hash: string) {
  return prisma.usuario.upsert({
    where: { email },
    update: {},
    create: { nombres, email, password: hash, rol },
  });
}

export async function sembrar(prisma: PrismaClient, { silencioso = false } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 10);

  // --- Configuración (P5, P6) ---
  for (const [clave, valor] of [
    ['duracion_bloque_min', '30'],
    ['monto_adelanto', '30.00'],
  ]) {
    await prisma.configuracion.upsert({ where: { clave }, update: { valor }, create: { clave, valor } });
  }

  // --- Usuarios del personal ---
  await usuario(prisma, 'Ana Ríos', 'ana.rios@clinica.local', 'recepcionista', hash);
  await usuario(prisma, 'Carlos Vega', 'carlos.vega@clinica.local', 'administrador', hash);
  const odontologos = [
    { nombres: 'Dr. Luis Paredes', email: 'luis.paredes@clinica.local', cmp: '00001', especialidad: 'Odontología general' },
    { nombres: 'Dra. Carmen Díaz', email: 'carmen.diaz@clinica.local', cmp: '00002', especialidad: 'Endodoncia' },
  ];
  for (const o of odontologos) {
    const u = await usuario(prisma, o.nombres, o.email, 'odontologo', hash);
    await prisma.odontologo.upsert({
      where: { usuarioId: u.id },
      update: {},
      create: { usuarioId: u.id, cmp: o.cmp, especialidad: o.especialidad },
    });
  }

  // --- Horario general de la clínica: L–S 08:00–20:00 (P4) ---
  if ((await prisma.horarioAtencion.count()) === 0) {
    await prisma.horarioAtencion.createMany({
      data: [1, 2, 3, 4, 5, 6].map((dia) => ({ odontologoId: null, diaSemana: dia, horaInicio: t('08:00'), horaFin: t('20:00') })),
    });
  }

  // --- Pacientes (ficticios). María Quispe tiene cuenta web. ---
  const pacientes = [
    { dni: '72458190', nombres: 'María', apellidos: 'Quispe Rojas', nac: '1990-04-12', tel: '949123456', email: 'maria.quispe@correo.local', cuenta: true, alergias: 'Penicilina' },
    { dni: '70112233', nombres: 'Lucía', apellidos: 'Torres Vega', nac: '1985-09-30', tel: '948222333' },
    { dni: '71223344', nombres: 'Jorge', apellidos: 'Salas', nac: '1978-01-15', tel: '947333444' },
    { dni: '72334455', nombres: 'Rosa', apellidos: 'Huamán', nac: '1995-06-21', tel: '946444555' },
    { dni: '73445566', nombres: 'Pedro', apellidos: 'Castillo', nac: '1982-11-02', tel: '945555666', inasistencias: 2 },
    { dni: '74556677', nombres: 'Diego', apellidos: 'Rojas', nac: '2001-03-08', tel: '944666777' },
  ];
  for (const p of pacientes) {
    const cuenta = p.cuenta ? await usuario(prisma, `${p.nombres} ${p.apellidos}`, p.email!, 'paciente', hash) : null;
    await prisma.paciente.upsert({
      where: { dni: p.dni },
      update: {},
      create: {
        dni: p.dni,
        nombres: p.nombres,
        apellidos: p.apellidos,
        fechaNacimiento: d(p.nac),
        telefono: p.tel,
        email: p.email,
        inasistencias: p.inasistencias ?? 0,
        usuarioId: cuenta?.id,
        ficha: { create: { alergias: p.alergias } }, // RN-05
      },
    });
  }

  // --- Insumos ---
  const insumos = [
    { nombre: 'Resina compuesta A2', unidad: 'jeringa', stock: 5, minimo: 5 },
    { nombre: 'Anestesia lidocaína 2 %', unidad: 'cartucho', stock: 18, minimo: 10 },
    { nombre: 'Guantes de nitrilo M', unidad: 'par', stock: 7, minimo: 10 },
    { nombre: 'Copa de goma', unidad: 'unidad', stock: 12, minimo: 5 },
    { nombre: 'Pasta profiláctica', unidad: 'pote', stock: 6, minimo: 3 },
    { nombre: 'Gel blanqueador', unidad: 'jeringa', stock: 4, minimo: 2 },
    { nombre: 'Gasa estéril', unidad: 'paquete', stock: 20, minimo: 8 },
  ];
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: 'carlos.vega@clinica.local' } });
  const idInsumo: Record<string, number> = {};
  for (const i of insumos) {
    const existe = await prisma.insumo.findUnique({ where: { nombre: i.nombre } });
    const ins =
      existe ??
      (await prisma.insumo.create({
        data: {
          nombre: i.nombre,
          unidad: i.unidad,
          stockActual: i.stock,
          stockMinimo: i.minimo,
          movimientos: { create: { tipo: 'inicial', cantidad: i.stock, saldo: i.stock, motivo: 'Inventario inicial', usuarioId: admin.id } },
        },
      }));
    idInsumo[i.nombre] = ins.id;
  }

  // --- Tarifario (RN-08) con los insumos que consume cada tratamiento ---
  // TODO(decisión): precios de Extracción, Blanqueamiento y Consulta no figuran en el informe; valores de ejemplo.
  const tarifario: { nombre: string; precio: number; insumos: [string, number][] }[] = [
    { nombre: 'Curación con resina', precio: 120, insumos: [['Resina compuesta A2', 1], ['Anestesia lidocaína 2 %', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Profilaxis', precio: 80, insumos: [['Pasta profiláctica', 1], ['Copa de goma', 1]] },
    { nombre: 'Extracción', precio: 100, insumos: [['Anestesia lidocaína 2 %', 1], ['Gasa estéril', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Blanqueamiento', precio: 350, insumos: [['Gel blanqueador', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Consulta', precio: 40, insumos: [['Guantes de nitrilo M', 1]] },
  ];
  for (const tr of tarifario) {
    if (await prisma.tratamiento.findUnique({ where: { nombre: tr.nombre } })) continue;
    await prisma.tratamiento.create({
      data: {
        nombre: tr.nombre,
        precio: tr.precio,
        insumos: { create: tr.insumos.map(([n, cantidad]) => ({ insumoId: idInsumo[n], cantidad })) },
      },
    });
  }

  // --- Proveedores (ficticios) ---
  await prisma.proveedor.upsert({
    where: { ruc: '20601234567' },
    update: {},
    create: { ruc: '20601234567', razonSocial: 'Distribuidora Odontomed S.A.C.', telefono: '044201234' },
  });
  await prisma.proveedor.upsert({
    where: { ruc: '20487654321' },
    update: {},
    create: { ruc: '20487654321', razonSocial: 'Dental Sur E.I.R.L.', telefono: '044205678' },
  });

  // --- Tipos de pago y descuentos (P3) ---
  for (const nombre of ['Efectivo', 'Tarjeta', 'Yape/Plin']) {
    await prisma.tipoPago.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  // TODO(decisión P3): descuentos reales por definir con la clínica
  await prisma.descuento.upsert({
    where: { nombre: 'Paciente frecuente' },
    update: {},
    create: { nombre: 'Paciente frecuente', porcentaje: 10 },
  });

  if (!silencioso) console.info(`Semilla cargada. Contraseña de los usuarios de prueba: ${PASSWORD}`);
}

// Ejecutado directamente (npm run db:seed)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient();
  sembrar(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
