// Datos de DEMOSTRACIÓN (se cargan con la semilla: npm run db:seed o SEED=true en Docker). TODO ES FICTICIO.
// Simula ~3 meses de historia de la clínica y las citas futuras hasta el 20/12/2026 (como mínimo 2 semanas), con
// 200 personas: 2 administradores, 2 recepcionistas, 5 odontólogos y 191 pacientes (96 con cuenta web y 95 presenciales,
// 10 de ellos con «DNI pendiente»). Respeta las reglas del sistema:
// adelanto del 50 % (100 % si está restringido), cobro final con el adelanto y el saldo a favor descontados,
// stock que baja con cada atención y sube con los pedidos recibidos, comprobantes numerados sin huecos y en orden.
// Siempre genera lo mismo (generador pseudoaleatorio con semilla fija); las fechas son relativas a «hoy».
// Corre una sola vez por base (marca «demo_cargado» en configuración).
import { Prisma, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { ahoraLima, diaSemana, sumarDias } from '../src/lib/fechas.js';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const fechaDB = (f: string) => new Date(`${f}T00:00:00Z`);
const horaDB = (h: string) => new Date(`1970-01-01T${h}:00Z`);
/** Instante real (Lima, UTC-5) de una fecha y hora locales */
const en = (f: string, h: string) => new Date(`${f}T${h}:00-05:00`);
const masMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Generador pseudoaleatorio con semilla (mulberry32): mismos datos en todas las PC
function generador(semilla: number) {
  let a = semilla;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entre = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));
  const uno = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const pesado = <T>(xs: readonly [T, number][]) => {
    let x = r() * xs.reduce((s, [, p]) => s + p, 0);
    for (const [v, p] of xs) if ((x -= p) < 0) return v;
    return xs[xs.length - 1][0];
  };
  return { r, entre, uno, pesado, si: (p: number) => r() < p };
}

const NOMBRES_F = ['Ana', 'Carmen', 'Rocío', 'Patricia', 'Milagros', 'Gabriela', 'Silvia', 'Elena', 'Valeria', 'Karina', 'Jessica', 'Flor', 'Yolanda', 'Camila', 'Luz', 'Diana', 'Teresa', 'Mariela'];
const NOMBRES_M = ['Luis', 'Carlos', 'José', 'Miguel', 'Julio', 'César', 'Raúl', 'Víctor', 'Hugo', 'Manuel', 'Óscar', 'Renzo', 'Fernando', 'Alberto', 'Daniel', 'Iván', 'Wilmer', 'Edwin'];
const APELLIDOS = ['Gutiérrez', 'Ramírez', 'Flores', 'Mendoza', 'Vásquez', 'Rodríguez', 'Sánchez', 'Cruz', 'Chávez', 'Paredes', 'Reyes', 'Alvarado', 'Cabrera', 'Zavaleta', 'Loyola', 'Benites', 'Rebaza', 'Asmat', 'Florián', 'Bazán', 'Ulloa', 'Polo', 'León', 'Narváez', 'Saldaña', 'Valverde', 'Castañeda', 'Otiniano'];
const CALLES = ['Av. España', 'Av. América Norte', 'Jr. Pizarro', 'Av. Larco', 'Calle Los Pinos', 'Av. Húsares de Junín', 'Jr. Bolívar', 'Av. Mansiche'];
const ALERGIAS = ['Penicilina', 'Látex', 'Ibuprofeno', 'Lidocaína (usar articaína)', 'Amoxicilina'];
const ANTECEDENTES = ['Hipertensión controlada', 'Diabetes tipo 2', 'Gastritis', 'Asma leve', 'Embarazo (2.º trimestre)'];
const MOTIVOS = ['Dolor de muela', 'Control', 'Limpieza', 'Sensibilidad al frío', 'Sangrado de encías', 'Revisión general', 'Muela rota', 'Mancha en un diente', 'Dolor al masticar', 'Blanqueamiento', 'Control de niño'];

// ---------- Catálogo ampliado del Administrador (ficticio) ----------
/** 8 proveedores más (10 en total); el último está desactivado */
const PROVEEDORES_EXTRA: [string, string, string, string, boolean][] = [
  ['20531122334', 'Importaciones Dentales del Norte S.A.C.', 'Karina Florián', '044221100', true],
  ['20612233445', 'Ortho Perú E.I.R.L.', 'Julio Bazán', '044223344', true],
  ['20488776655', 'Biodent Insumos S.R.L.', 'Rocío Saldaña', '044225566', true],
  ['20577889900', 'Endo Supply Trujillo S.A.C.', 'Hugo Loyola', '044227788', true],
  ['20599001122', 'Descartables Médicos La Libertad S.A.C.', 'Teresa Ulloa', '044229900', true],
  ['20455667788', 'Radiología Dental Andina S.A.C.', 'César Rebaza', '044231122', true],
  ['20622334455', 'Perio Lab E.I.R.L.', 'Mariela León', '044233344', true],
  ['20433445566', 'Dental Express Chimbote S.A.C.', 'Wilmer Polo', '043355566', false],
];
/** 21 insumos más (30 en total): nombre, unidad, stock mínimo, activo */
const INSUMOS_EXTRA: [string, string, number, boolean][] = [
  ['Anestesia articaína 4 %', 'cartucho', 10, true],
  ['Agujas dentales cortas', 'unidad', 15, true],
  ['Eyector de saliva', 'unidad', 20, true],
  ['Babero descartable', 'unidad', 20, true],
  ['Mascarilla quirúrgica', 'unidad', 20, true],
  ['Rollos de algodón', 'paquete', 4, true],
  ['Ácido grabador 37 %', 'jeringa', 2, true],
  ['Adhesivo dental', 'frasco', 2, true],
  ['Ionómero de vidrio', 'kit', 1, true],
  ['Hidróxido de calcio', 'kit', 1, true],
  ['Fresa diamantada', 'unidad', 8, true],
  ['Cemento temporal', 'pote', 2, true],
  ['Limas de endodoncia', 'juego', 2, true],
  ['Conos de gutapercha', 'caja', 2, true],
  ['Hipoclorito de sodio 5 %', 'frasco', 2, true],
  ['Sutura seda 3-0', 'sobre', 5, true],
  ['Brackets metálicos', 'kit', 2, true],
  ['Arco de níquel titanio', 'unidad', 6, true],
  ['Ligaduras elásticas', 'paquete', 3, true],
  ['Amalgama dental', 'cápsula', 5, false],
  ['Fresa de carburo descontinuada', 'unidad', 5, false],
];
/** 16 tratamientos más (25 en total): nombre, precio, insumos [nombre, cantidad], activo */
const TRATAMIENTOS_EXTRA: [string, number, [string, number][], boolean][] = [
  ['Endodoncia unirradicular', 350, [['Limas de endodoncia', 0.25], ['Conos de gutapercha', 0.25], ['Hipoclorito de sodio 5 %', 0.2], ['Anestesia articaína 4 %', 1], ['Guantes de nitrilo M', 1]], true],
  ['Endodoncia multirradicular', 550, [['Limas de endodoncia', 0.5], ['Conos de gutapercha', 0.5], ['Hipoclorito de sodio 5 %', 0.3], ['Anestesia articaína 4 %', 2], ['Guantes de nitrilo M', 1]], true],
  ['Pulpotomía', 150, [['Hidróxido de calcio', 0.1], ['Ionómero de vidrio', 0.1], ['Anestesia lidocaína 2 %', 1], ['Guantes de nitrilo M', 1]], true],
  ['Raspado y alisado radicular', 180, [['Anestesia articaína 4 %', 1], ['Agujas dentales cortas', 1], ['Gasa estéril', 1], ['Eyector de saliva', 1], ['Guantes de nitrilo M', 1]], true],
  ['Gingivectomía', 300, [['Anestesia articaína 4 %', 2], ['Sutura seda 3-0', 1], ['Gasa estéril', 2], ['Guantes de nitrilo M', 1]], true],
  ['Control de ortodoncia', 100, [['Ligaduras elásticas', 0.25], ['Guantes de nitrilo M', 1]], true],
  ['Instalación de brackets', 1200, [['Brackets metálicos', 1], ['Arco de níquel titanio', 1], ['Ácido grabador 37 %', 0.5], ['Adhesivo dental', 0.25], ['Guantes de nitrilo M', 1]], true],
  ['Carilla de resina', 250, [['Resina compuesta A2', 1], ['Ácido grabador 37 %', 0.25], ['Adhesivo dental', 0.1], ['Guantes de nitrilo M', 1]], true],
  ['Férula de descarga', 400, [['Guantes de nitrilo M', 1], ['Babero descartable', 1]], true],
  ['Reconstrucción con poste', 280, [['Resina compuesta A2', 1], ['Fresa diamantada', 1], ['Adhesivo dental', 0.1], ['Guantes de nitrilo M', 1]], true],
  ['Radiografía periapical', 25, [['Babero descartable', 1], ['Guantes de nitrilo M', 1]], true],
  ['Curación con ionómero', 90, [['Ionómero de vidrio', 0.1], ['Rollos de algodón', 0.2], ['Guantes de nitrilo M', 1]], true],
  ['Cementado de corona', 120, [['Cemento temporal', 0.25], ['Rollos de algodón', 0.2], ['Guantes de nitrilo M', 1]], true],
  ['Extracción de diente de leche', 60, [['Anestesia lidocaína 2 %', 1], ['Gasa estéril', 1], ['Guantes de nitrilo M', 1]], true],
  ['Curación con amalgama', 70, [['Amalgama dental', 1]], false],
  ['Blanqueamiento casero', 300, [['Gel blanqueador', 2]], false],
];
const sinTildesDominio = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '').slice(0, 20);

/** Atenciones típicas: tratamientos (por nombre) y diagnóstico; `esp` = solo el odontólogo de esa especialidad */
const ATENCIONES: [{ t: string[]; dx: string; obs?: string; ninos?: boolean; esp?: string }, number][] = [
  [{ t: ['Consulta'], dx: 'Evaluación general sin hallazgos de urgencia', obs: 'Se indica limpieza en la próxima visita' }, 18],
  [{ t: ['Consulta', 'Profilaxis'], dx: 'Placa bacteriana generalizada', obs: 'Reforzar técnica de cepillado' }, 14],
  [{ t: ['Destartraje'], dx: 'Cálculo dental supragingival y gingivitis leve', obs: 'Control en 6 meses' }, 10],
  [{ t: ['Curación con resina'], dx: 'Caries de esmalte y dentina', obs: 'Evitar alimentos duros por 24 h' }, 16],
  [{ t: ['Curación con resina', 'Curación con resina'], dx: 'Caries múltiples', obs: 'Programar control de las demás piezas' }, 5],
  [{ t: ['Extracción simple'], dx: 'Resto radicular', obs: 'Indicaciones post-extracción entregadas' }, 7],
  [{ t: ['Extracción compleja'], dx: 'Tercera molar semi-incluida', obs: 'Control en 7 días' }, 3],
  [{ t: ['Blanqueamiento'], dx: 'Pigmentación extrínseca', obs: 'Evitar café y bebidas oscuras por 48 h' }, 4],
  [{ t: ['Profilaxis', 'Aplicación de flúor'], dx: 'Placa bacteriana; riesgo de caries moderado', ninos: true }, 6],
  [{ t: ['Aplicación de flúor'], dx: 'Prevención de caries', ninos: true }, 5],
  [{ t: ['Sellante (por pieza)', 'Sellante (por pieza)'], dx: 'Fosas y fisuras profundas en molares', ninos: true }, 4],
  [{ t: ['Curación con ionómero'], dx: 'Caries cervical por abrasión', obs: 'Control en 6 meses' }, 3],
  [{ t: ['Carilla de resina'], dx: 'Fractura del borde incisal', obs: 'Evitar morder objetos duros' }, 2],
  [{ t: ['Reconstrucción con poste', 'Radiografía periapical'], dx: 'Diente con endodoncia y gran destrucción coronaria' }, 2],
  [{ t: ['Cementado de corona'], dx: 'Corona provisional desprendida' }, 2],
  [{ t: ['Férula de descarga'], dx: 'Bruxismo nocturno con desgaste dental', obs: 'Usar la férula todas las noches' }, 1],
  // Especialidades: cada odontólogo atiende lo suyo
  [{ t: ['Endodoncia unirradicular', 'Radiografía periapical'], dx: 'Pulpitis irreversible en pieza anterior', obs: 'Control radiográfico en 6 meses', esp: 'Endodoncia' }, 14],
  [{ t: ['Endodoncia multirradicular', 'Radiografía periapical'], dx: 'Necrosis pulpar en molar', obs: 'Colocar corona en las próximas semanas', esp: 'Endodoncia' }, 10],
  [{ t: ['Raspado y alisado radicular'], dx: 'Periodontitis crónica moderada', obs: 'Control en 3 meses', esp: 'Periodoncia' }, 16],
  [{ t: ['Gingivectomía'], dx: 'Agrandamiento gingival', obs: 'Retirar puntos en 7 días', esp: 'Periodoncia' }, 5],
  [{ t: ['Control de ortodoncia'], dx: 'Control mensual: cambio de ligaduras', esp: 'Ortodoncia' }, 20],
  [{ t: ['Instalación de brackets', 'Radiografía periapical'], dx: 'Maloclusión clase I con apiñamiento', obs: 'Primer control en 30 días', esp: 'Ortodoncia' }, 3],
  [{ t: ['Pulpotomía'], dx: 'Caries profunda en molar de leche', ninos: true, esp: 'Odontopediatría' }, 8],
  [{ t: ['Extracción de diente de leche'], dx: 'Diente de leche con movilidad y permanente erupcionando', ninos: true, esp: 'Odontopediatría' }, 8],
];
const CON_PIEZA = new Set(['Curación con resina', 'Extracción simple', 'Extracción compleja', 'Sellante (por pieza)', 'Endodoncia unirradicular', 'Endodoncia multirradicular', 'Pulpotomía', 'Extracción de diente de leche', 'Carilla de resina', 'Reconstrucción con poste', 'Curación con ionómero', 'Cementado de corona']);
const PIEZAS_LECHE = ['54', '55', '64', '65', '74', '75', '84', '85'];
/** Pieza coherente con el tratamiento */
const piezaPara = (n: string, nino: boolean, uno: <T>(xs: readonly T[]) => T) =>
  n === 'Extracción compleja' ? uno(['18', '28', '38', '48'])
  : n === 'Pulpotomía' || n === 'Extracción de diente de leche' ? uno(PIEZAS_LECHE)
  : n === 'Endodoncia unirradicular' || n === 'Carilla de resina' ? uno(['11', '12', '13', '21', '22', '23'])
  : n === 'Endodoncia multirradicular' ? uno(['16', '26', '36', '46'])
  : uno(nino ? PIEZAS_NINO : PIEZAS_ADULTO);
const PIEZAS_ADULTO = ['11', '12', '14', '15', '16', '17', '21', '24', '25', '26', '27', '34', '35', '36', '37', '38', '44', '45', '46', '47', '48'];
const PIEZAS_NINO = ['16', '26', '36', '46', '17', '27', '37', '47'];

type Pac = { id: number; usuarioId: number | null; edad: number; nino: boolean; inasist: number; restringido: boolean; saldo: Prisma.Decimal; abonos: { id: number; restante: Prisma.Decimal }[]; dni: string | null; nombres: string; apellidos: string; fichaId: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sembrarDemo(prisma: PrismaClient<any>, { silencioso = false } = {}) {
  if (await prisma.configuracion.findUnique({ where: { clave: 'demo_cargado' } })) {
    if (!silencioso) console.info('Datos de demostración: ya estaban cargados.');
    return;
  }
  if ((await prisma.cita.count()) > 0) {
    if (!silencioso) console.info('Datos de demostración: la base ya tiene citas; no se agregan (use una base nueva).');
    return;
  }
  const g = generador(2026);
  const ahora = new Date();
  const { fecha: hoy, hora: horaAhora } = ahoraLima(ahora);
  const T0 = sumarDias(hoy, -91); // inicio de la historia
  const hash = await bcrypt.hash('Clinica2026', 10);

  // ---------- Personal adicional ----------
  const sofia = await prisma.usuario.upsert({ where: { email: 'sofia.mendoza@clinica.local' }, update: {}, create: { nombres: 'Sofía Mendoza', email: 'sofia.mendoza@clinica.local', password: hash, rol: 'recepcionista' } });
  const uChavez = await prisma.usuario.upsert({ where: { email: 'andres.chavez@clinica.local' }, update: {}, create: { nombres: 'Dr. Andrés Chávez', email: 'andres.chavez@clinica.local', password: hash, rol: 'odontologo' } });
  const chavez = await prisma.odontologo.upsert({ where: { usuarioId: uChavez.id }, update: {}, create: { usuarioId: uChavez.id, cmp: '00003', especialidad: 'Ortodoncia' } });
  if ((await prisma.horarioAtencion.count({ where: { odontologoId: chavez.id } })) === 0) {
    await prisma.horarioAtencion.createMany({ data: [2, 3, 4, 5, 6].map((dia) => ({ odontologoId: chavez.id, diaSemana: dia, horaInicio: horaDB('09:00'), horaFin: horaDB('13:00') })) });
  }
  // Segundo administrador (Carlos Vega sigue siendo el principal, RN-23)
  await prisma.usuario.upsert({ where: { email: 'patricia.salazar@clinica.local' }, update: {}, create: { nombres: 'Patricia Salazar', email: 'patricia.salazar@clinica.local', password: hash, rol: 'administrador' } });
  // Dos odontólogos más (5 en total), cada uno con su horario
  for (const x of [
    { nombres: 'Dra. Rocío Benites', email: 'rocio.benites@clinica.local', cmp: '00004', especialidad: 'Odontopediatría', tramos: [1, 2, 3, 4, 5].map((dia) => [dia, '14:00', '19:00'] as const) },
    { nombres: 'Dr. Miguel Asmat', email: 'miguel.asmat@clinica.local', cmp: '00005', especialidad: 'Periodoncia', tramos: [[1, '08:00', '13:00'], [3, '08:00', '13:00'], [5, '08:00', '13:00'], [6, '08:00', '12:00']] as const },
  ]) {
    const u = await prisma.usuario.upsert({ where: { email: x.email }, update: {}, create: { nombres: x.nombres, email: x.email, password: hash, rol: 'odontologo' } });
    const od = await prisma.odontologo.upsert({ where: { usuarioId: u.id }, update: {}, create: { usuarioId: u.id, cmp: x.cmp, especialidad: x.especialidad } });
    if ((await prisma.horarioAtencion.count({ where: { odontologoId: od.id } })) === 0) {
      await prisma.horarioAtencion.createMany({ data: x.tramos.map(([dia, ini, fin]) => ({ odontologoId: od.id, diaSemana: dia, horaInicio: horaDB(ini), horaFin: horaDB(fin) })) });
    }
  }
  const ana = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ana.rios@clinica.local' } });
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: 'carlos.vega@clinica.local' } });
  const recepcionistas = [ana, ana, sofia]; // Ana atiende más turnos

  // Horarios de cada odontólogo (propio o general)
  const odontologos = await prisma.odontologo.findMany({ where: { activo: true }, include: { usuario: true, horarios: true } });
  const general = await prisma.horarioAtencion.findMany({ where: { odontologoId: null } });
  const bloquesDe = (o: (typeof odontologos)[number], f: string) => {
    const tramos = (o.horarios.length ? o.horarios : general).filter((h) => h.diaSemana === diaSemana(f));
    const b: string[] = [];
    for (const t of tramos) {
      const ini = t.horaInicio.getUTCHours() * 60 + t.horaInicio.getUTCMinutes();
      const fin = t.horaFin.getUTCHours() * 60 + t.horaFin.getUTCMinutes();
      for (let m = ini; m + 30 <= fin; m += 30) b.push(hhmm(m));
    }
    return b;
  };
  const feriados = new Set((await prisma.feriado.findMany()).map((x) => x.fecha.toISOString().slice(0, 10)));

  // ---------- Catálogo ampliado (Administrador): 10 proveedores, 30 insumos y 25 tratamientos ----------
  for (const [ruc, razonSocial, contacto, telefono, activo] of PROVEEDORES_EXTRA) {
    await prisma.proveedor.upsert({ where: { ruc }, update: {}, create: { ruc, razonSocial, contacto, telefono, email: `ventas@${sinTildesDominio(razonSocial)}.local`, activo, createdAt: en(sumarDias(T0, -200), '10:00') } });
  }
  for (const [nombre, unidad, minimo, activo] of INSUMOS_EXTRA) {
    if (await prisma.insumo.findUnique({ where: { nombre } })) continue;
    const inicial = minimo * 4 + 15;
    await prisma.insumo.create({
      data: { nombre, unidad, stockActual: inicial, stockMinimo: minimo, activo, createdAt: en(sumarDias(T0, -30), '09:00'),
        movimientos: { create: { tipo: 'inicial', cantidad: inicial, saldo: inicial, motivo: 'Inventario inicial', usuarioId: admin.id, createdAt: en(sumarDias(T0, -1), '08:00') } } },
    });
  }
  for (const [nombre, precio, lista, activo] of TRATAMIENTOS_EXTRA) {
    if (await prisma.tratamiento.findUnique({ where: { nombre } })) continue;
    const ids = await prisma.insumo.findMany({ where: { nombre: { in: lista.map(([n]) => n) } } });
    await prisma.tratamiento.create({
      data: { nombre, precio, activo, createdAt: en(sumarDias(T0, -30), '09:30'), insumos: { create: lista.map(([n, cantidad]) => ({ insumoId: ids.find((x) => x.nombre === n)!.id, cantidad })) } },
    });
  }

  // ---------- Tarifario, insumos y tipos de pago ----------
  const tratamientos = await prisma.tratamiento.findMany({ include: { insumos: true } });
  const trat = Object.fromEntries(tratamientos.map((t) => [t.nombre, t]));
  const insumos = await prisma.insumo.findMany({ where: { activo: true } });
  const tipos = Object.fromEntries((await prisma.tipoPago.findMany()).map((t) => [t.nombre, t.id]));
  const billetera = tipos.Yape ?? tipos.Plin ?? tipos['Yape/Plin'];
  const tipoSaldo = tipos['Saldo a favor'];

  // Campaña de ejemplo dentro del periodo, para que haya descuentos en los reportes
  const campana = await prisma.descuento.upsert({
    where: { nombre: 'Campaña de primavera (demo)' },
    update: {},
    create: {
      nombre: 'Campaña de primavera (demo)', porcentaje: 15, fechaInicio: fechaDB(sumarDias(hoy, -45)), fechaFin: fechaDB(sumarDias(hoy, -20)),
      tratamientos: { create: ['Profilaxis', 'Destartraje'].map((n) => ({ tratamientoId: trat[n].id })) },
    },
  });

  // ---------- Pacientes ----------
  const existentes = await prisma.paciente.findMany({ include: { ficha: true } });
  const pacientes: Pac[] = existentes.map((p) => ({
    id: p.id, usuarioId: p.usuarioId, edad: Number(hoy.slice(0, 4)) - p.fechaNacimiento.getUTCFullYear(), nino: false, inasist: p.inasistencias, restringido: p.restringido,
    saldo: D(p.saldoFavor), abonos: [], dni: p.dni, nombres: p.nombres, apellidos: p.apellidos, fichaId: p.ficha!.id,
  }));
  const usados = new Set(existentes.map((p) => p.dni));
  const nuevoDni = () => {
    let x: string;
    do x = String(g.entre(40_000_000, 79_999_999));
    while (usados.has(x));
    usados.add(x);
    return x;
  };
  const celular = () => `9${g.entre(10_000_000, 99_999_999)}`;
  // Metas: 96 pacientes con cuenta web y 95 presenciales (sin cuenta), contando los de la semilla
  const META_WEB = 96;
  const META_PRESENCIAL = 95;
  const SIN_DNI = 11; // presenciales registrados sin DNI a la mano; a uno ya le completaron el DNI → quedan 10 pendientes
  const nWeb = Math.max(0, META_WEB - existentes.filter((p) => p.usuarioId).length);
  const nPresencial = Math.max(0, META_PRESENCIAL - existentes.filter((p) => !p.usuarioId).length);
  const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
  const correos = new Set((await prisma.usuario.findMany({ select: { email: true } })).map((u) => u.email));
  const correoDe = (nombres: string, apellidos: string) => {
    const base = `${sinTildes(nombres.split(' ')[0])}.${sinTildes(apellidos.split(' ')[0])}`;
    let email = `${base}@correo.local`;
    for (let k = 2; correos.has(email); k++) email = `${base}${k}@correo.local`;
    correos.add(email);
    return email;
  };
  for (let i = 0; i < nWeb + nPresencial; i++) {
    const web = i < nWeb;
    const j = web ? i : i - nWeb; // posición dentro de su grupo
    const mujer = g.si(0.55);
    // menores: 2 con cuenta web (registrados por su apoderado) y 12 presenciales
    const nino = web ? j < 2 : j < 12;
    const sinDni = !web && j >= nPresencial - SIN_DNI; // registrados sin DNI a la mano (en las últimas semanas)
    const nombres = mujer ? g.uno(NOMBRES_F) : g.uno(NOMBRES_M);
    const apellidos = `${g.uno(APELLIDOS)} ${g.uno(APELLIDOS)}`;
    const edad = nino ? g.entre(5, 15) : g.entre(19, 72);
    const nac = `${Number(hoy.slice(0, 4)) - edad - 1}-${String(g.entre(1, 12)).padStart(2, '0')}-${String(g.entre(1, 28)).padStart(2, '0')}`;
    const creado = sinDni ? en(sumarDias(hoy, -g.entre(2, 12)), '10:00') : en(sumarDias(T0, -g.entre(5, 300)), '11:00');
    const email = web || (!nino && g.si(0.3)) ? correoDe(nombres, apellidos) : null;
    const usuario = web ? await prisma.usuario.create({ data: { nombres: `${nombres} ${apellidos}`, email: email!, password: hash, rol: 'paciente', createdAt: creado } }) : null;
    const p = await prisma.paciente.create({
      data: {
        dni: sinDni ? null : nuevoDni(), nombres, apellidos, sexo: mujer ? 'femenino' : 'masculino', fechaNacimiento: fechaDB(nac), telefono: celular(),
        email, usuarioId: usuario?.id ?? null,
        direccion: g.si(0.6) ? `${g.uno(CALLES)} ${g.entre(100, 2500)}, Trujillo` : null,
        ...(nino ? { apoderado: `${g.uno(g.si(0.5) ? NOMBRES_F : NOMBRES_M)} ${apellidos.split(' ')[0]}`, apoderadoDni: nuevoDni(), apoderadoTelefono: celular() } : {}),
        createdAt: creado,
        ficha: { create: { alergias: g.si(0.15) ? g.uno(ALERGIAS) : null, antecedentes: !nino && g.si(0.2) ? g.uno(ANTECEDENTES) : null } },
      },
      include: { ficha: true },
    });
    pacientes.push({ id: p.id, usuarioId: usuario?.id ?? null, edad, nino, inasist: 0, restringido: false, saldo: D(0), abonos: [], dni: p.dni, nombres, apellidos, fichaId: p.ficha!.id });
  }
  // Los pacientes de la semilla ya eran pacientes antes del periodo simulado
  await prisma.paciente.updateMany({ where: { id: { in: existentes.map((p) => p.id) } }, data: { createdAt: en(sumarDias(T0, -120), '10:00') } });
  // DNI que traerá después el primer paciente registrado sin DNI (se reserva aquí para que la lista de usuarios no cambie según el día)
  const dniCompletado = nuevoDni();
  const conHistoria = pacientes.filter((p) => p.dni !== null);
  const sinDni = pacientes.filter((p) => p.dni === null);
  const maria = pacientes.find((p) => p.dni === '72458190');
  const pedro = pacientes.find((p) => p.dni === '73445566');
  // Pacientes que faltan alguna vez (Pedro llega a 3 → queda restringido, RN-12)
  const faltones = new Map<number, number>([[pedro?.id ?? -1, 1], ...conHistoria.filter((p) => !p.nino).slice(10, 22).map((p, i) => [p.id, i < 3 ? 3 : 1] as [number, number])]);

  // ---------- Inventario: stock inicial al comienzo de la historia ----------
  const stock = new Map(insumos.map((i) => [i.id, D(i.stockMinimo).mul(4).plus(15)]));
  const minimo = new Map(insumos.map((i) => [i.id, D(i.stockMinimo)]));
  await prisma.alertaStock.deleteMany({});
  for (const i of insumos) {
    await prisma.movimientoKardex.updateMany({ where: { insumoId: i.id, tipo: 'inicial' }, data: { cantidad: stock.get(i.id)!, saldo: stock.get(i.id)!, createdAt: en(sumarDias(T0, -1), '08:00') } });
  }
  const alertaAbierta = new Map<number, number>(); // insumoId → alertaId
  const pedidoEnCurso = new Set<number>(); // insumos ya pedidos
  const recepciones: { cuando: Date; pedidoId: number; lineas: { insumoId: number; cantidad: Prisma.Decimal }[]; diferencia: boolean }[] = [];
  let nPedido = 0;
  const proveedores = await prisma.proveedor.findMany({ where: { activo: true }, orderBy: { id: 'asc' } });
  // Cada insumo se compra siempre al mismo proveedor (así hay varios pedidos chicos, como en la vida real)
  const proveedorDe = new Map(insumos.map((i, k) => [i.id, proveedores[(k * 4 + Math.floor(k / proveedores.length)) % proveedores.length].id]));

  async function moverStock(insumoId: number, cantidad: Prisma.Decimal, tipo: 'salida_tratamiento' | 'entrada_recepcion' | 'merma' | 'ajuste', cuando: Date, ref: { tipo: string; id: number }, motivo: string) {
    const saldo = stock.get(insumoId)!.plus(cantidad);
    stock.set(insumoId, saldo);
    await prisma.movimientoKardex.create({ data: { insumoId, tipo, cantidad, saldo, motivo, referenciaTipo: ref.tipo, referenciaId: ref.id, usuarioId: admin.id, createdAt: cuando } });
    if (cantidad.isNegative() && saldo.lessThanOrEqualTo(minimo.get(insumoId)!) && !alertaAbierta.has(insumoId)) {
      const a = await prisma.alertaStock.create({ data: { insumoId, stockAlGenerar: saldo, createdAt: cuando } });
      alertaAbierta.set(insumoId, a.id);
    }
  }

  /** Recibe los pedidos cuya fecha ya llegó y, si hay alertas sin pedido, el Administrador pide (como en CU-30/CU-33). */
  async function inventarioHasta(cuando: Date) {
    for (const rc of recepciones.filter((x) => x.cuando <= cuando).sort((a, b) => +a.cuando - +b.cuando)) {
      recepciones.splice(recepciones.indexOf(rc), 1);
      const ped = await prisma.pedido.findUniqueOrThrow({ where: { id: rc.pedidoId }, include: { detalles: true } });
      for (const det of ped.detalles) {
        const recibida = rc.diferencia && det === ped.detalles[0] ? det.cantidadPedida.minus(2) : det.cantidadPedida;
        await prisma.detallePedido.update({ where: { id: det.id }, data: { cantidadRecibida: recibida } });
        await moverStock(det.insumoId, recibida, 'entrada_recepcion', rc.cuando, { tipo: 'pedido', id: ped.id }, `Recepción ${ped.codigo}`);
        pedidoEnCurso.delete(det.insumoId);
        const alerta = alertaAbierta.get(det.insumoId);
        if (alerta && stock.get(det.insumoId)!.greaterThan(minimo.get(det.insumoId)!)) {
          await prisma.alertaStock.update({ where: { id: alerta }, data: { revisada: true, revisadaPorId: admin.id, revisadaEn: rc.cuando } });
          alertaAbierta.delete(det.insumoId);
        }
      }
      await prisma.pedido.update({
        where: { id: ped.id },
        data: { estado: rc.diferencia ? 'recibido_con_diferencias' : 'recibido', recibidoEn: rc.cuando, observacionRecepcion: rc.diferencia ? 'Llegaron 2 unidades menos; el proveedor las repone en el próximo pedido' : null, updatedAt: rc.cuando },
      });
    }
    // El Administrador pide cuando hay alerta o cuando el stock ya está en el doble del mínimo (para no quedarse sin insumos)
    const porPedir = [...stock.keys()].filter((id) => !pedidoEnCurso.has(id) && (alertaAbierta.has(id) || stock.get(id)!.lessThanOrEqualTo(minimo.get(id)!.mul(1.3).plus(2))));
    if (porPedir.length === 0) return;
    // El Administrador revisa las alertas al día siguiente a las 09:00 y hace el pedido «desde alerta»
    const dia = new Date(cuando.getTime() + 86_400_000).toISOString().slice(0, 10);
    const pedidoEn = en(dia, '09:00');
    if (pedidoEn > ahora) return; // aún no lo revisa: quedan alertas pendientes
    const porProveedor = new Map<number, number[]>();
    for (const id of porPedir) porProveedor.set(proveedorDe.get(id)!, [...(porProveedor.get(proveedorDe.get(id)!) ?? []), id]);
    for (const [proveedorId, ids] of porProveedor) {
      const p = await prisma.pedido.create({
        data: {
          codigo: `PED-${String(++nPedido).padStart(4, '0')}`, proveedorId, registradoPorId: admin.id, createdAt: pedidoEn, updatedAt: pedidoEn,
          detalles: { create: ids.map((insumoId) => ({ insumoId, cantidadPedida: Prisma.Decimal.max(minimo.get(insumoId)!.mul(2.5), 10) })) },
        },
      });
      ids.forEach((id) => pedidoEnCurso.add(id));
      const llega = new Date(pedidoEn.getTime() + g.entre(1, 3) * 86_400_000 + 5 * 3_600_000);
      if (llega <= ahora) recepciones.push({ cuando: llega, pedidoId: p.id, lineas: [], diferencia: nPedido % 11 === 3 });
    }
  }

  /** Red de seguridad: si un insumo no alcanza para la atención, se compra de urgencia ese mismo día (pedido recibido al instante). */
  async function compraUrgente(insumoId: number, falta: Prisma.Decimal, cuando: Date) {
    const cantidad = Prisma.Decimal.max(falta.plus(minimo.get(insumoId)!.mul(2)), 10);
    const p = await prisma.pedido.create({
      data: {
        codigo: `PED-${String(++nPedido).padStart(4, '0')}`, proveedorId: proveedorDe.get(insumoId)!, registradoPorId: admin.id, estado: 'recibido', recibidoEn: cuando,
        observacionRecepcion: 'Compra urgente: el stock no alcanzaba para las atenciones del día', createdAt: masMin(cuando, -90), updatedAt: cuando,
        detalles: { create: [{ insumoId, cantidadPedida: cantidad, cantidadRecibida: cantidad }] },
      },
    });
    // misma hora que la atención (justo antes en el kárdex): otra atención a esa hora pudo usar el insumo
    await moverStock(insumoId, cantidad, 'entrada_recepcion', cuando, { tipo: 'pedido', id: p.id }, `Recepción ${p.codigo} (urgente)`);
  }

  // ---------- Saldo a favor ----------
  async function abonar(p: Pac, monto: Prisma.Decimal, tipo: 'abono_sobrante' | 'abono_cancelacion', cuando: Date, citaId: number, comprobanteId: number | null, motivo: string) {
    p.saldo = p.saldo.plus(monto);
    const venceEn = new Date(cuando);
    venceEn.setUTCMonth(venceEn.getUTCMonth() + 12);
    const m = await prisma.saldoMovimiento.create({ data: { pacienteId: p.id, tipo, monto, saldo: p.saldo, citaId, comprobanteId, motivo, usuarioId: ana.id, restante: monto, venceEn, createdAt: cuando } });
    p.abonos.push({ id: m.id, restante: monto });
  }
  async function usarSaldo(p: Pac, monto: Prisma.Decimal, cuando: Date, citaId: number, comprobanteId: number, motivo: string) {
    let falta = monto;
    for (const a of p.abonos) {
      if (falta.lte(0)) break;
      const usa = Prisma.Decimal.min(a.restante, falta);
      if (usa.lte(0)) continue;
      a.restante = a.restante.minus(usa);
      falta = falta.minus(usa);
      await prisma.saldoMovimiento.update({ where: { id: a.id }, data: { restante: a.restante } });
    }
    p.saldo = p.saldo.minus(monto);
    await prisma.saldoMovimiento.create({ data: { pacienteId: p.id, tipo: 'uso_en_cobro', monto: monto.neg(), saldo: p.saldo, citaId, comprobanteId, motivo, usuarioId: ana.id, createdAt: cuando } });
  }

  // ---------- Comprobantes (se numeran al final, por fecha de emisión) ----------
  let tmp = 0;
  const pago = (total: Prisma.Decimal, preferido?: 'Efectivo' | 'Yape' | 'Tarjeta') => {
    const tipo = preferido ?? g.pesado<'Efectivo' | 'Yape' | 'Tarjeta'>([['Efectivo', 50], ['Yape', 35], ['Tarjeta', 15]]);
    const recibido = tipo === 'Efectivo' && total.gt(0) ? D(Math.ceil(total.toNumber() / 10) * 10 + (g.si(0.3) ? 10 : 0)) : total;
    return { tipoPagoId: tipo === 'Yape' ? billetera : tipos[tipo], operacion: tipo === 'Yape' ? String(g.entre(10_000_000, 99_999_999)) : null, montoRecibido: recibido, vuelto: recibido.minus(total) };
  };
  async function comprobanteAdelanto(citaId: number, p: Pac, monto: Prisma.Decimal, cuando: Date, emisor: number, desc: string) {
    return prisma.comprobante.create({
      data: { numero: `TMP-${++tmp}`, tipo: 'adelanto', citaId, pacienteId: p.id, subtotal: monto, total: monto, ...pago(monto, g.si(0.6) ? 'Yape' : 'Efectivo'), emitidoPorId: emisor, createdAt: cuando, detalles: { create: [{ descripcion: desc, precio: monto }] } },
    });
  }

  // ---------- Citas ----------
  const ocupado = new Set<string>();
  let citasCreadas = 0;
  // Cada paciente viene unas pocas veces (María, la paciente con cuenta web, unas 5); nadie tiene dos citas el mismo día
  const visitas = new Map<number, number>();
  const ocupadoDia = new Set<string>();
  const elegirPaciente = (nino: boolean, f: string) => {
    const lista = conHistoria.filter((p) => p.nino === nino && !ocupadoDia.has(`${p.id}|${f}`) && (p !== maria || (visitas.get(p.id) ?? 0) < 5));
    const conMenos = [...lista].sort((a, b) => (visitas.get(a.id) ?? 0) - (visitas.get(b.id) ?? 0)).slice(0, Math.max(8, Math.ceil(lista.length / 3)));
    const p = maria && !nino && lista.includes(maria) && g.si(0.03) ? maria : g.uno(conMenos.length ? conMenos : conHistoria);
    visitas.set(p.id, (visitas.get(p.id) ?? 0) + 1);
    ocupadoDia.add(`${p.id}|${f}`);
    return p;
  };
  /** Hora en que se hizo la reserva: días antes, en horario de la clínica (08:00–19:30) */
  const reservaAntes = (f: string, diasMin: number, diasMax: number) => en(sumarDias(f, -g.entre(diasMin, diasMax)), hhmm(g.entre(16, 39) * 30));
  const adelantoDe = (p: Pac, previsto: string) => D(trat[previsto].precio).mul(p.restringido ? 1 : 0.5).toDecimalPlaces(2);

  async function crearCita(o: (typeof odontologos)[number], f: string, h: string, p: Pac, previsto: string, estado: string, creada: Date, extra: Record<string, unknown> = {}) {
    ocupado.add(`${o.id}|${f}|${h}`);
    // Los pacientes con cuenta reservan casi siempre por la web; los demás, en la clínica
    const web = !!p.usuarioId && g.si(0.7);
    citasCreadas++;
    return prisma.cita.create({
      data: {
        pacienteId: p.id, odontologoId: o.id, fecha: fechaDB(f), hora: horaDB(h), motivo: g.uno(MOTIVOS), canal: web ? 'web' : 'presencial', estado: estado as never,
        tratamientoPrevistoId: trat[previsto].id, montoAdelanto: adelantoDe(p, previsto), creadoPorId: web ? p.usuarioId! : g.uno(recepcionistas).id,
        tokenConfirmacion: crypto.randomUUID(), createdAt: creada, updatedAt: creada, ...extra,
      },
    });
  }

  /** Atención + consumo de insumos (+ cobro si `cobrar`) */
  async function atender(cita: { id: number; odontologoId: number; fecha: Date }, p: Pac, f: string, h: string, cobrar: boolean, anular = false) {
    const especialidad = odontologos.find((x) => x.id === cita.odontologoId)?.especialidad ?? '';
    const opciones = ATENCIONES.filter(([a]) => (p.nino ? a.ninos || a.t[0] === 'Consulta' : !a.ninos) && (!a.esp || a.esp === especialidad));
    const a = g.pesado(opciones);
    const cuando = masMin(en(f, h), 25);
    const lineas = a.t.map((n) => ({ nombre: n, pieza: CON_PIEZA.has(n) ? piezaPara(n, p.nino, g.uno) : null }));
    const at = await prisma.atencion.create({
      data: {
        citaId: cita.id, fichaId: p.fichaId, odontologoId: cita.odontologoId, diagnostico: a.dx, observaciones: a.obs ?? null, createdAt: cuando, updatedAt: cuando,
        tratamientos: { create: lineas.map((l) => ({ tratamientoId: trat[l.nombre].id, piezaDental: l.pieza, precioAplicado: trat[l.nombre].precio })) },
      },
    });
    for (const l of lineas) {
      for (const ti of trat[l.nombre].insumos) {
        if (stock.get(ti.insumoId)!.lessThan(ti.cantidad)) await compraUrgente(ti.insumoId, D(ti.cantidad).minus(stock.get(ti.insumoId)!), cuando);
      }
      for (const ti of trat[l.nombre].insumos) await moverStock(ti.insumoId, D(ti.cantidad).neg(), 'salida_tratamiento', cuando, { tipo: 'atencion', id: at.id }, `${l.nombre} — atención #${at.id}`);
    }
    // RN-22: el odontólogo abrió el historial antes de atender
    if (g.si(0.6)) await prisma.auditoria.create({ data: { usuarioId: (await prisma.odontologo.findUniqueOrThrow({ where: { id: cita.odontologoId } })).usuarioId, accion: 'ver_historial', pacienteId: p.id, ip: '192.168.1.20', createdAt: masMin(cuando, -20) } });
    if (!cobrar) return;
    const cobro = masMin(cuando, g.entre(15, 50));
    const adel = await prisma.comprobante.findFirst({ where: { citaId: cita.id, tipo: 'adelanto', anuladoEn: null } });
    const adelanto = adel ? D(adel.subtotal) : D(0);
    const enCampana = cobro >= campana.fechaInicio && cobro <= new Date(campana.fechaFin.getTime() + 86_400_000);
    const det = lineas.map((l) => {
      const precio = D(trat[l.nombre].precio);
      const conDesc = enCampana && ['Profilaxis', 'Destartraje'].includes(l.nombre);
      return { tratamientoId: trat[l.nombre].id, descripcion: l.pieza ? `${l.nombre} (pieza ${l.pieza})` : l.nombre, precio, descuento: conDesc ? precio.mul(0.15).toDecimalPlaces(2) : D(0), descuentoId: conDesc ? campana.id : null };
    });
    const subtotal = det.reduce((s, x) => s.plus(x.precio), D(0));
    const descuento = det.reduce((s, x) => s.plus(x.descuento), D(0));
    const neto = subtotal.minus(descuento);
    const adelantoAplicado = Prisma.Decimal.min(adelanto, neto);
    const saldoAplicado = Prisma.Decimal.min(p.saldo, neto.minus(adelantoAplicado));
    const total = neto.minus(adelantoAplicado).minus(saldoAplicado);
    const emitir = async (momento: Date) =>
      prisma.comprobante.create({
        data: {
          numero: `TMP-${++tmp}`, tipo: 'servicio', citaId: cita.id, pacienteId: p.id, subtotal, descuento, adelantoAplicado, saldoAplicado,
          ...(total.isZero() ? { tipoPagoId: saldoAplicado.gt(0) ? tipoSaldo : tipos.Efectivo, operacion: null, montoRecibido: D(0), vuelto: D(0) } : pago(total)),
          total, emitidoPorId: g.uno(recepcionistas).id, createdAt: momento, detalles: { create: det },
        },
      });
    let c = await emitir(cobro);
    if (anular) {
      // Se cobró con el tipo de pago equivocado: se anula (RN-19) y se emite de nuevo
      await prisma.comprobante.update({ where: { id: c.id }, data: { anuladoEn: masMin(cobro, 6), anuladoPorId: ana.id, motivoAnulacion: 'Se registró con el tipo de pago equivocado' } });
      await prisma.auditoria.create({ data: { usuarioId: ana.id, accion: 'anular_comprobante', pacienteId: p.id, detalle: `Comprobante del servicio, S/ ${total.toFixed(2)}: Se registró con el tipo de pago equivocado`, ip: '192.168.1.10', createdAt: masMin(cobro, 6) } });
      c = await emitir(masMin(cobro, 8));
    }
    if (saldoAplicado.gt(0)) await usarSaldo(p, saldoAplicado, cobro, cita.id, c.id, 'Usado en el cobro del servicio');
    const sobrante = adelanto.minus(adelantoAplicado);
    if (sobrante.gt(0)) await abonar(p, sobrante, 'abono_sobrante', cobro, cita.id, c.id, 'Adelanto no usado en el cobro');
    await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'pagada', updatedAt: cobro } });
  }

  // ---------- Historia: de T0 hasta ayer, y hoy hasta la hora actual ----------
  let ajustes = 0;
  let anuladoHecho = false;
  let devolucionHecha = false;
  let edicionHecha = false;
  for (let f = T0; f <= hoy; f = sumarDias(f, 1)) {
    if (diaSemana(f) === 7 || feriados.has(f)) continue;
    // Ajustes de stock antes de abrir (CU-25): merma de un lote o diferencia en el conteo físico, unos 2 por semana
    if (f < hoy && g.si(0.3)) {
      const cuando = en(f, '07:45');
      await inventarioHasta(cuando);
      const ins = g.uno(insumos);
      const actual = stock.get(ins.id)!;
      const [tipo, cantidad, motivo] = g.pesado<['merma' | 'ajuste', number, string]>([
        [['merma', -g.entre(1, 3), g.uno(['Lote vencido retirado del inventario', 'Envase dañado al recibirlo', 'Caja dañada por humedad', 'Se contaminó durante la atención'])], 5],
        [['ajuste', -g.entre(1, 2), 'Conteo físico: faltaban unidades'], 2],
        [['ajuste', g.entre(1, 2), 'Conteo físico: sobraban unidades'], 2],
      ]);
      if (actual.plus(cantidad).greaterThan(0)) {
        await moverStock(ins.id, D(cantidad), tipo, cuando, { tipo: 'ajuste', id: ins.id }, motivo);
        ajustes++;
      }
    }
    // Las citas del día de todos los odontólogos, en orden de hora (el stock y el kárdex avanzan en orden)
    const turnos = odontologos.flatMap((o) => {
      const bloques = bloquesDe(o, f);
      const n = f === hoy ? Math.min(3, bloques.length) : g.entre(1, 2);
      return [...bloques].sort(() => g.r() - 0.5).slice(0, bloques.length ? n : 0).map((h) => ({ o, h }));
    }).sort((a, b) => a.h.localeCompare(b.h) || a.o.id - b.o.id);
    {
      for (const { o, h } of turnos) {
        const futuro = f === hoy && h >= horaAhora;
        if (futuro) continue; // lo que queda de hoy se arma con las próximas citas
        const inicio = en(f, h);
        await inventarioHasta(inicio);
        const p = elegirPaciente(g.si(o.especialidad === 'Odontopediatría' ? 0.45 : 0.04), f);
        const previsto = g.si(0.7) ? 'Consulta' : g.pesado<string>([['Profilaxis', 3], ['Curación con resina', 3], ['Destartraje', 2], ['Blanqueamiento', 1]]);
        const creada = reservaAntes(f, 1, 8);
        const pagoAdelanto = masMin(creada, g.entre(5, 50));
        // hoy: lo que empezó hace poco aún no se atiende (así ningún movimiento ni cobro queda con hora futura)
        const resultado = f === hoy
          ? masMin(inicio, 80) > ahora ? 'confirmada' : g.pesado<string>([['pagada', 5], ['atendida', 2], ['confirmada', 1]])
          : faltones.get(p.id) && g.si(0.5)
            ? 'inasistencia'
            : g.pesado<string>([['pagada', 82], ['cancelada', 5], ['cancelada_pagada', 4], ['liberada', 5], ['clinica', devolucionHecha ? 0 : 1]]);

        if (resultado === 'liberada') {
          // reservó y no pagó el adelanto en 1 hora: el horario se liberó
          await crearCita(o, f, h, p, previsto, 'liberada', creada, { adelantoVenceEn: masMin(creada, 60), updatedAt: masMin(creada, 62) });
          ocupado.delete(`${o.id}|${f}|${h}`);
          continue;
        }
        if (resultado === 'cancelada') {
          await crearCita(o, f, h, p, previsto, 'cancelada', creada, { adelantoVenceEn: masMin(creada, 60), updatedAt: masMin(creada, 30) });
          ocupado.delete(`${o.id}|${f}|${h}`);
          continue;
        }
        const cita = await crearCita(o, f, h, p, previsto, 'confirmada', creada);
        const desc = `Adelanto ${p.restringido ? '100' : '50'} % (${previsto}) — cita del ${f.split('-').reverse().join('/')} ${h}`;
        const adel = await comprobanteAdelanto(cita.id, p, D(cita.montoAdelanto!), pagoAdelanto, g.uno(recepcionistas).id, desc);

        if (resultado === 'cancelada_pagada') {
          // canceló con 24 h o más: el adelanto queda como saldo a favor (RN-16)
          const cuando = masMin(inicio, -g.entre(26, 60) * 60);
          await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'cancelada', updatedAt: cuando } });
          await abonar(p, D(adel.subtotal), 'abono_cancelacion', cuando, cita.id, null, 'Canceló con 24 h o más de anticipación');
          continue;
        }
        if (resultado === 'clinica') {
          // la clínica canceló (el odontólogo no pudo atender): se devuelve el adelanto
          devolucionHecha = true;
          const cuando = masMin(inicio, -20 * 60);
          await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'cancelada', updatedAt: cuando } });
          await prisma.devolucion.create({ data: { citaId: cita.id, pacienteId: p.id, monto: adel.subtotal, motivo: 'Cita cancelada por la clínica (el odontólogo no pudo atender)', usuarioId: ana.id, createdAt: cuando } });
          continue;
        }
        if (resultado === 'inasistencia') {
          faltones.set(p.id, faltones.get(p.id)! - 1);
          p.inasist++;
          p.restringido = p.inasist >= 3;
          await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'inasistencia', updatedAt: masMin(inicio, 40) } });
          continue;
        }
        if (resultado === 'confirmada') continue; // hoy: aún no llega (se puede registrar la inasistencia)
        const anular = !anuladoHecho && f >= sumarDias(hoy, -10);
        if (anular) anuladoHecho = true;
        await atender(cita, p, f, h, resultado === 'pagada', anular);
        if (resultado === 'atendida') await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'atendida' } }); // hoy: falta cobrar en caja
        if (!edicionHecha && resultado === 'pagada' && f >= sumarDias(hoy, -6)) {
          // CU-44: el odontólogo corrigió el diagnóstico (RN-20)
          edicionHecha = true;
          const at = await prisma.atencion.findUniqueOrThrow({ where: { citaId: cita.id }, include: { tratamientos: { include: { tratamiento: true } } } });
          const cuando = masMin(inicio, 120);
          await prisma.atencionEdicion.create({ data: { atencionId: at.id, usuarioId: o.usuarioId, motivo: 'Faltó anotar la pieza afectada en el diagnóstico', anterior: { diagnostico: at.diagnostico, observaciones: at.observaciones, tratamientos: at.tratamientos.map((x) => ({ nombre: x.tratamiento.nombre, piezaDental: x.piezaDental })) }, createdAt: cuando } });
          await prisma.atencion.update({ where: { id: at.id }, data: { diagnostico: `${at.diagnostico} (pieza ${at.tratamientos.find((x) => x.piezaDental)?.piezaDental ?? '16'})`, updatedAt: cuando } });
          await prisma.auditoria.create({ data: { usuarioId: o.usuarioId, accion: 'editar_atencion', pacienteId: p.id, detalle: `Atención de la cita #${cita.id}: Faltó anotar la pieza afectada en el diagnóstico`, ip: '192.168.1.20', createdAt: cuando } });
        }
      }
    }
  }
  await inventarioHasta(ahora);

  // ---------- Próximas citas: lo que queda de hoy y hasta el 20/12/2026 (como mínimo, las próximas 2 semanas) ----------
  let pendientes = 0;
  let enVerificacion = 0;
  const finAgenda = [sumarDias(hoy, 14), '2026-12-20'].sort()[1];
  for (let f = hoy; f <= finAgenda; f = sumarDias(f, 1)) {
    if (diaSemana(f) === 7 || feriados.has(f)) continue;
    const cerca = f <= sumarDias(hoy, 14); // la agenda se llena más cuanto más cerca está la fecha
    for (const o of odontologos) {
      const libres = bloquesDe(o, f).filter((h) => !ocupado.has(`${o.id}|${f}|${h}`) && (f > hoy || h > horaAhora));
      const n = Math.min(libres.length, f === hoy ? 3 : cerca ? g.entre(1, 3) : g.entre(0, 2));
      for (const h of [...libres].sort(() => g.r() - 0.5).slice(0, n).sort()) {
        const nuevo = sinDni.length > 0 && g.si(0.25);
        const p = nuevo ? sinDni.shift()! : elegirPaciente(g.si(0.07), f);
        const previsto = nuevo || g.si(0.75) ? 'Consulta' : g.pesado<string>([['Profilaxis', 3], ['Curación con resina', 2], ['Blanqueamiento', 1]]);
        const estado = !cerca ? 'confirmada' : pendientes < 3 && g.si(0.15) ? 'pendiente_adelanto' : enVerificacion < 2 && g.si(0.12) ? 'pago_en_verificacion' : 'confirmada';
        if (estado === 'pendiente_adelanto') {
          pendientes++;
          // recién reservada: tiene 1 hora para pagar (la tarea programada la libera si no paga)
          await crearCita(o, f, h, p, previsto, estado, masMin(ahora, -g.entre(3, 15)), { adelantoVenceEn: masMin(ahora, 50) });
        } else if (estado === 'pago_en_verificacion') {
          enVerificacion++;
          const creada = masMin(ahora, -25);
          await crearCita(o, f, h, p, previsto, estado, creada, { adelantoVenceEn: masMin(creada, 60), pagoMetodo: 'yape', pagoOperacion: String(g.entre(10_000_000, 99_999_999)), pagoReportadoEn: masMin(ahora, -10) });
        } else {
          const creada = new Date(Math.min(+reservaAntes(hoy, 1, 6), +masMin(en(f, h), -1440)));
          const cita = await crearCita(o, f, h, p, previsto, 'confirmada', creada);
          await comprobanteAdelanto(cita.id, p, D(cita.montoAdelanto!), masMin(creada, g.entre(5, 50)), g.uno(recepcionistas).id, `Adelanto ${p.restringido ? '100' : '50'} % (${previsto}) — cita del ${f.split('-').reverse().join('/')} ${h}`);
        }
      }
    }
  }
  // Pacientes sin DNI que quedaron sin cita: también tienen una para la próxima semana
  for (const p of sinDni) {
    const o = odontologos[0];
    for (let f = sumarDias(hoy, 3); f <= sumarDias(hoy, 14); f = sumarDias(f, 1)) {
      const h = bloquesDe(o, f).find((x) => !ocupado.has(`${o.id}|${f}|${x}`));
      if (!h || feriados.has(f)) continue;
      const cita = await crearCita(o, f, h, p, 'Consulta', 'confirmada', masMin(ahora, -2 * 1440));
      await comprobanteAdelanto(cita.id, p, D(cita.montoAdelanto!), masMin(ahora, -2 * 1440 + 20), ana.id, `Adelanto 50 % (Consulta) — cita del ${f.split('-').reverse().join('/')} ${h}`);
      break;
    }
  }

  // Cierre del inventario: hoy se retiraron lotes vencidos o dañados (merma, RN-13) de insumos que la agenda hasta el
  // 20/12 necesita → quedan en el mínimo, con su alerta sin revisar; el Administrador ya pidió algunos (pedidos pendientes).
  const cierre: [string, string][] = [
    ['Guantes de nitrilo M', 'Caja dañada por humedad'],
    ['Resina compuesta A2', 'Lote vencido retirado del inventario'],
    ['Anestesia articaína 4 %', 'Lote vencido retirado del inventario'],
    ['Limas de endodoncia', 'Instrumental deformado: se descartó'],
    ['Ligaduras elásticas', 'Paquete abierto y contaminado'],
    ['Gel blanqueador', 'Lote vencido retirado del inventario'],
  ];
  // los movimientos del cierre van después de todo lo registrado hoy (el kárdex queda en orden)
  const ultimoAntes = (await prisma.movimientoKardex.aggregate({ _max: { createdAt: true } }))._max.createdAt ?? ahora;
  const baseCierre = Math.max(+masMin(ahora, -30), +ultimoAntes + 60_000);
  const pedirYa = ['Guantes de nitrilo M', 'Anestesia articaína 4 %', 'Limas de endodoncia', 'Ligaduras elásticas'];
  for (const [k, [nombre, motivo]] of cierre.entries()) {
    const ins = insumos.find((i) => i.nombre === nombre);
    if (!ins) continue;
    const baja = stock.get(ins.id)!.minus(minimo.get(ins.id)!.minus(1));
    const cuando = new Date(Math.min(baseCierre + k * 60_000, +ahora));
    if (baja.gt(0)) {
      await prisma.movimientoKardex.create({ data: { insumoId: ins.id, tipo: 'merma', cantidad: baja.neg(), saldo: stock.get(ins.id)!.minus(baja), motivo, referenciaTipo: 'ajuste', referenciaId: ins.id, usuarioId: admin.id, createdAt: cuando } });
      stock.set(ins.id, stock.get(ins.id)!.minus(baja));
      ajustes++;
    }
    if (!alertaAbierta.has(ins.id) && stock.get(ins.id)!.lte(minimo.get(ins.id)!)) alertaAbierta.set(ins.id, (await prisma.alertaStock.create({ data: { insumoId: ins.id, stockAlGenerar: stock.get(ins.id)!, createdAt: cuando } })).id);
    if (pedirYa.includes(nombre) && !pedidoEnCurso.has(ins.id)) {
      pedidoEnCurso.add(ins.id);
      await prisma.pedido.create({
        data: { codigo: `PED-${String(++nPedido).padStart(4, '0')}`, proveedorId: proveedorDe.get(ins.id)!, registradoPorId: admin.id, createdAt: masMin(cuando, 3), updatedAt: masMin(cuando, 3), detalles: { create: [{ insumoId: ins.id, cantidadPedida: Prisma.Decimal.max(minimo.get(ins.id)!.mul(5), 20) }] } },
      });
    }
  }

  // Pendiente 33: el 80 % de los insumos queda con 100 o más (para probar sin quedarse sin stock) y el 20 % —los del
  // cierre— con stock bajo y su alerta. La reposición se recibió hoy, después de todo lo demás (el kárdex sigue en orden).
  const bajos = new Set(cierre.map(([n]) => insumos.find((i) => i.nombre === n)?.id).filter((x): x is number => x !== undefined));
  const reponer = insumos.filter((i) => !bajos.has(i.id) && stock.get(i.id)!.lessThan(100));
  const ultimo = await prisma.movimientoKardex.aggregate({ _max: { createdAt: true } });
  const recibido = new Date(Math.max(+masMin(ahora, -1), +(ultimo._max.createdAt ?? ahora)));
  const porProveedorRep = new Map<number, typeof reponer>();
  for (const i of reponer) porProveedorRep.set(proveedorDe.get(i.id)!, [...(porProveedorRep.get(proveedorDe.get(i.id)!) ?? []), i]);
  for (const [proveedorId, lista] of porProveedorRep) {
    const cantidades = lista.map((i) => ({ insumoId: i.id, cantidad: D(100).minus(stock.get(i.id)!).plus(g.entre(5, 40)).ceil() }));
    const p = await prisma.pedido.create({
      data: {
        codigo: `PED-${String(++nPedido).padStart(4, '0')}`, proveedorId, registradoPorId: admin.id, estado: 'recibido', recibidoEn: recibido,
        observacionRecepcion: 'Reposición para la agenda de diciembre', createdAt: en(sumarDias(hoy, -2), '09:30'), updatedAt: recibido,
        detalles: { create: cantidades.map((x) => ({ insumoId: x.insumoId, cantidadPedida: x.cantidad, cantidadRecibida: x.cantidad })) },
      },
    });
    for (const x of cantidades) {
      await moverStock(x.insumoId, x.cantidad, 'entrada_recepcion', recibido, { tipo: 'pedido', id: p.id }, `Recepción ${p.codigo}`);
      const alerta = alertaAbierta.get(x.insumoId);
      if (alerta) {
        await prisma.alertaStock.update({ where: { id: alerta }, data: { revisada: true, revisadaPorId: admin.id, revisadaEn: recibido } });
        alertaAbierta.delete(x.insumoId);
      }
    }
  }

  // Dos pedidos anulados en la historia
  for (const [dias, motivo, k] of [[30, 'Se registró dos veces por error', 0], [52, 'El proveedor ya no tenía stock; se pidió a otro', 3]] as const) {
    await prisma.pedido.create({
      data: {
        codigo: `PED-${String(++nPedido).padStart(4, '0')}`, proveedorId: proveedores[k % proveedores.length].id, estado: 'anulado', motivoAnulacion: motivo, registradoPorId: admin.id,
        createdAt: en(sumarDias(hoy, -dias), '09:10'), updatedAt: en(sumarDias(hoy, -dias), '09:15'),
        detalles: { create: [{ insumoId: insumos[k].id, cantidadPedida: 10 }] },
      },
    });
  }

  // Campañas de diciembre que llegan hasta el final de la agenda (20/12)
  for (const [nombre, porcentaje, desde, tratamientosCampana, edadMaxima] of [
    ['Sonrisa escolar (diciembre)', 25, sumarDias(hoy, -3), ['Aplicación de flúor', 'Sellante (por pieza)', 'Pulpotomía'], 17],
    ['Cuidado de encías (diciembre)', 15, sumarDias(hoy, 5), ['Raspado y alisado radicular', 'Destartraje'], null],
  ] as const) {
    if (await prisma.descuento.findUnique({ where: { nombre } })) continue;
    await prisma.descuento.create({
      data: { nombre, porcentaje, fechaInicio: fechaDB(desde), fechaFin: fechaDB(finAgenda), edadMaxima, tratamientos: { create: tratamientosCampana.map((n) => ({ tratamientoId: trat[n].id })) } },
    });
  }

  // ---------- Numeración final de comprobantes: C-000001… en orden de emisión ----------
  await prisma.$executeRaw`UPDATE comprobantes SET numero = 'X-' || id`;
  await prisma.$executeRaw`
    UPDATE comprobantes c SET numero = 'C-' || lpad(o.n::text, 6, '0')
      FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM comprobantes) o
     WHERE o.id = c.id`;

  // ---------- Totales por paciente, stock final y algunos eventos de auditoría ----------
  for (const p of pacientes) {
    await prisma.paciente.update({ where: { id: p.id }, data: { saldoFavor: p.saldo, inasistencias: p.inasist, restringido: p.restringido } });
  }
  for (const [insumoId, s] of stock) await prisma.insumo.update({ where: { id: insumoId }, data: { stockActual: s } });

  const luis = await prisma.usuario.findUniqueOrThrow({ where: { email: 'luis.paredes@clinica.local' } });
  const otro = conHistoria[14];
  await prisma.auditoria.createMany({
    data: [
      { usuarioId: luis.id, accion: 'bloqueo_login', detalle: '3 intentos fallidos con la cuenta luis.paredes@clinica.local', ip: '192.168.1.20', createdAt: en(sumarDias(hoy, -12), '07:55') },
      { usuarioId: admin.id, accion: 'desbloqueo_login', detalle: 'Desbloqueó la cuenta luis.paredes@clinica.local', ip: '192.168.1.5', createdAt: en(sumarDias(hoy, -12), '08:02') },
      { usuarioId: ana.id, accion: 'corregir_paciente', pacienteId: otro.id, detalle: `Apellidos: «${otro.apellidos.replace(/á/g, 'a').replace(/é/g, 'e')}» → «${otro.apellidos}». Motivo: Faltaban las tildes del apellido`, ip: '192.168.1.10', createdAt: en(sumarDias(hoy, -5), '10:30') },
    ],
  });
  // Un paciente que vino sin DNI la semana pasada y ya lo trajo
  const completado = pacientes.filter((p) => p.dni === null)[0];
  if (completado) {
    const dni = dniCompletado;
    await prisma.paciente.update({ where: { id: completado.id }, data: { dni } });
    await prisma.auditoria.create({ data: { usuarioId: sofia.id, accion: 'cambiar_dni', pacienteId: completado.id, detalle: `Completó el DNI pendiente: ${dni}`, ip: '192.168.1.11', createdAt: masMin(ahora, -1440) } });
  }

  await prisma.configuracion.create({ data: { clave: 'demo_cargado', valor: new Date().toISOString() } });
  if (!silencioso) {
    const [nc, nco, na, nped] = await Promise.all([prisma.cita.count(), prisma.comprobante.count(), prisma.atencion.count(), prisma.pedido.count()]);
    console.info(`Datos de demostración cargados: ${pacientes.length} pacientes, ${nc} citas (${citasCreadas} nuevas), ${na} atenciones, ${nco} comprobantes, ${nped} pedidos, ${ajustes} ajustes de stock.`);
  }
}
