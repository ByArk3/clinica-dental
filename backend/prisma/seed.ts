// Datos semilla (sección 13 del brief). TODOS LOS DATOS SON FICTICIOS.
// Contraseña de todos los usuarios de prueba: Clinica2026
import { PrismaClient, type Rol } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

export const PASSWORD = 'Clinica2026';
const t = (h: string) => new Date(`1970-01-01T${h}:00Z`);
const d = (f: string) => new Date(`${f}T00:00:00Z`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function usuario(prisma: PrismaClient<any>, nombres: string, email: string, rol: Rol, hash: string) {
  return prisma.usuario.upsert({
    where: { email },
    update: {},
    create: { nombres, email, password: hash, rol },
  });
}

/** Feriados nacionales del Perú (no se atiende). Semana Santa: 2026 → 2 y 3 abr; 2027 → 25 y 26 mar. */
const FERIADOS: [string, string][] = [
  ['01-01', 'Año Nuevo'],
  ['05-01', 'Día del Trabajo'],
  ['06-07', 'Batalla de Arica y Día de la Bandera'],
  ['06-29', 'San Pedro y San Pablo'],
  ['07-23', 'Día de la Fuerza Aérea del Perú'],
  ['07-28', 'Fiestas Patrias'],
  ['07-29', 'Fiestas Patrias'],
  ['08-06', 'Batalla de Junín'],
  ['08-30', 'Santa Rosa de Lima'],
  ['10-08', 'Combate de Angamos'],
  ['11-01', 'Día de Todos los Santos'],
  ['12-08', 'Inmaculada Concepción'],
  ['12-09', 'Batalla de Ayacucho'],
  ['12-25', 'Navidad'],
];
const SEMANA_SANTA: Record<number, [string, string]> = { 2026: ['04-02', '04-03'], 2027: ['03-25', '03-26'] };

interface OpcionesSemilla {
  silencioso?: boolean;
  /** Horario propio de cada odontólogo (si no, todos usan el general L–S 08:00–20:00) */
  horariosEjemplo?: boolean;
  campanas?: boolean;
  feriados?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sembrar(prisma: PrismaClient<any>, { silencioso = false, horariosEjemplo = true, campanas = true, feriados = true }: OpcionesSemilla = {}) {
  const hash = await bcrypt.hash(PASSWORD, 10);

  // --- Configuración: bloques de 30 min (P5) y datos de Yape/Plin para el adelanto (FICTICIOS) ---
  for (const [clave, valor] of [
    ['duracion_bloque_min', '30'],
    ['pago_numero', '987654321'],
    ['pago_titular', 'Clínica Dental (ficticio)'],
    ['pago_billeteras', 'yape'], // billeteras aceptadas: yape, plin o ambas (Configuración → Pagos)
    ['saldo_vigencia_meses', '12'], // vigencia del saldo a favor (0 = no vence)
  ]) {
    await prisma.configuracion.upsert({ where: { clave }, update: {}, create: { clave, valor } });
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
  // Horario propio de ejemplo: Dr. Paredes L–V 08:00–14:00 · Dra. Díaz L–S 14:00–20:00 (el Administrador lo cambia)
  if (horariosEjemplo) {
    const ejemplo: [string, number[], string, string][] = [
      ['luis.paredes@clinica.local', [1, 2, 3, 4, 5], '08:00', '14:00'],
      ['carmen.diaz@clinica.local', [1, 2, 3, 4, 5, 6], '14:00', '20:00'],
    ];
    for (const [email, dias, inicio, fin] of ejemplo) {
      const o = await prisma.odontologo.findFirstOrThrow({ where: { usuario: { email } } });
      if ((await prisma.horarioAtencion.count({ where: { odontologoId: o.id } })) > 0) continue;
      await prisma.horarioAtencion.createMany({ data: dias.map((dia) => ({ odontologoId: o.id, diaSemana: dia, horaInicio: t(inicio), horaFin: t(fin) })) });
    }
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
    { nombre: 'Barniz de flúor', unidad: 'dosis', stock: 30, minimo: 10 },
    { nombre: 'Sellante de fosas y fisuras', unidad: 'jeringa', stock: 6, minimo: 2 },
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
          // RN-14: si ya empieza en el mínimo o por debajo, nace con su alerta
          ...(i.stock <= i.minimo ? { alertas: { create: { stockAlGenerar: i.stock } } } : {}),
        },
      }));
    idInsumo[i.nombre] = ins.id;
  }

  // --- Tarifario (RN-08) con los insumos que consume cada tratamiento ---
  // Precios estimados para Trujillo (nov. 2026), acordados con el equipo; la clínica debe confirmarlos.
  const tarifario: { nombre: string; precio: number; insumos: [string, number][] }[] = [
    { nombre: 'Consulta', precio: 40, insumos: [['Guantes de nitrilo M', 1]] },
    { nombre: 'Profilaxis', precio: 80, insumos: [['Pasta profiláctica', 1], ['Copa de goma', 1]] },
    { nombre: 'Destartraje', precio: 120, insumos: [['Pasta profiláctica', 1], ['Copa de goma', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Curación con resina', precio: 120, insumos: [['Resina compuesta A2', 1], ['Anestesia lidocaína 2 %', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Extracción simple', precio: 80, insumos: [['Anestesia lidocaína 2 %', 1], ['Gasa estéril', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Extracción compleja', precio: 250, insumos: [['Anestesia lidocaína 2 %', 2], ['Gasa estéril', 2], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Blanqueamiento', precio: 450, insumos: [['Gel blanqueador', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Aplicación de flúor', precio: 40, insumos: [['Barniz de flúor', 1], ['Guantes de nitrilo M', 1]] },
    { nombre: 'Sellante (por pieza)', precio: 35, insumos: [['Sellante de fosas y fisuras', 0.25]] },
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

  // --- Tipos de pago ---
  for (const nombre of ['Efectivo', 'Tarjeta', 'Saldo a favor']) {
    await prisma.tipoPago.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  // Billetera digital: se llama «Yape», «Plin» o «Yape/Plin» según lo que acepte la clínica (no se duplica al renombrarla)
  if (!(await prisma.tipoPago.findFirst({ where: { nombre: { in: ['Yape', 'Plin', 'Yape/Plin'] } } }))) {
    await prisma.tipoPago.create({ data: { nombre: 'Yape' } });
  }

  const anio = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date()));
  const idTrat = async (nombre: string) => (await prisma.tratamiento.findUniqueOrThrow({ where: { nombre } })).id;

  // --- Campañas de descuento (acordadas con el equipo; porcentajes editables por el Administrador) ---
  if (campanas) {
    for (const a of [anio, anio + 1]) {
      const lista: { nombre: string; tipo?: 'porcentaje' | 'tres_por_dos'; porcentaje?: number; desde: string; hasta: string; edadMaxima?: number; tratamientos: string[] }[] = [
        { nombre: `Campaña escolar ${a}`, porcentaje: 30, desde: `${a}-02-01`, hasta: `${a}-03-31`, edadMaxima: 17, tratamientos: ['Aplicación de flúor', 'Sellante (por pieza)'] },
        { nombre: `Fiestas Patrias ${a} — limpieza`, porcentaje: 20, desde: `${a}-07-01`, hasta: `${a}-07-31`, tratamientos: ['Profilaxis', 'Destartraje'] },
        { nombre: `Fiestas Patrias ${a} — blanqueamiento`, porcentaje: 25, desde: `${a}-07-01`, hasta: `${a}-07-31`, tratamientos: ['Blanqueamiento'] },
        { nombre: `Fiestas Patrias ${a} — resinas 3x2`, tipo: 'tres_por_dos', desde: `${a}-07-01`, hasta: `${a}-07-31`, tratamientos: ['Curación con resina'] },
        { nombre: `Día de la Odontología Peruana ${a}`, porcentaje: 50, desde: `${a}-12-04`, hasta: `${a}-12-04`, tratamientos: ['Consulta'] },
        { nombre: `Campaña navideña ${a}`, porcentaje: 20, desde: `${a}-12-01`, hasta: `${a}-12-31`, tratamientos: ['Blanqueamiento', 'Destartraje'] },
      ];
      for (const c of lista) {
        if (await prisma.descuento.findUnique({ where: { nombre: c.nombre } })) continue;
        await prisma.descuento.create({
          data: {
            nombre: c.nombre,
            tipo: c.tipo ?? 'porcentaje',
            porcentaje: c.tipo === 'tres_por_dos' ? null : c.porcentaje,
            fechaInicio: d(c.desde),
            fechaFin: d(c.hasta),
            edadMaxima: c.edadMaxima ?? null,
            tratamientos: { create: await Promise.all(c.tratamientos.map(async (n) => ({ tratamientoId: await idTrat(n) }))) },
          },
        });
      }
    }
  }

  // --- Feriados nacionales (no se atiende) ---
  if (feriados) {
    for (const a of [anio, anio + 1]) {
      const dias = [...FERIADOS, ...(SEMANA_SANTA[a] ? [[SEMANA_SANTA[a][0], 'Jueves Santo'], [SEMANA_SANTA[a][1], 'Viernes Santo']] : [])] as [string, string][];
      for (const [md, nombre] of dias) {
        await prisma.feriado.upsert({ where: { fecha: d(`${a}-${md}`) }, update: {}, create: { fecha: d(`${a}-${md}`), nombre } });
      }
    }
  }

  if (!silencioso) console.info(`Semilla cargada. Contraseña de los usuarios de prueba: ${PASSWORD}`);
}

// Ejecutado directamente (npm run db:seed)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient();
  sembrar(prisma)
    // Datos de demostración (3 meses de historia y próximas citas), solo con SEED_DEMO=true
    .then(async () => {
      if (process.env.SEED_DEMO === 'true' || process.argv.includes('--demo')) await (await import('./demo.js')).sembrarDemo(prisma);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
