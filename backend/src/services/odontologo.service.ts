import { prisma } from '../lib/prisma.js';
import { dateAHora } from '../lib/fechas.js';

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** «Lunes–Viernes» para días seguidos; «Lunes, Miércoles» para sueltos. */
function nombreDias(dias: number[]) {
  const d = [...new Set(dias)].sort((a, b) => a - b);
  const seguidos = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return seguidos ? `${DIAS[d[0]]}–${DIAS[d.at(-1)!]}` : d.map((x) => DIAS[x]).join(', ');
}

/**
 * Horario de atención en texto (el propio o, si no tiene, el general de la clínica):
 * corto «Lunes–Viernes 08:00–14:00» (para la lista) y largo «lunes a viernes, de 08:00 a 14:00» (debajo del campo).
 * Varios turnos se separan con «; ».
 */
export function resumenHorario(tramos: { diaSemana: number; horaInicio: Date; horaFin: Date }[]) {
  const grupos = new Map<string, number[]>();
  for (const t of [...tramos].sort((a, b) => a.diaSemana - b.diaSemana)) {
    const clave = `${dateAHora(t.horaInicio)}–${dateAHora(t.horaFin)}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), t.diaSemana]);
  }
  // un día con dos turnos (mañana y tarde) se muestra junto: «Lunes 08:00–10:00 y 16:00–17:00»
  const porDias = new Map<string, string[]>();
  for (const [horas, dias] of [...grupos].sort((a, b) => a[0].localeCompare(b[0]))) {
    const k = nombreDias(dias);
    porDias.set(k, [...(porDias.get(k) ?? []), horas]);
  }
  const partes = [...porDias].map(([dias, horas]) => ({ dias, horas }));
  const corto = partes.map((p) => `${p.dias} ${p.horas.join(' y ')}`).join('; ');
  const largo = partes
    .map((p) => {
      const dias = p.dias.includes('–') ? p.dias.toLowerCase().replace('–', ' a ') : p.dias.toLowerCase().replace(/, ([^,]+)$/, ' y $1');
      return `${dias}, ${p.horas.map((h) => `de ${h.replace('–', ' a ')}`).join(' y ')}`;
    })
    .join('; ');
  return { corto, largo };
}

export async function listarOdontologosActivos() {
  const [lista, general] = await Promise.all([
    prisma.odontologo.findMany({
      where: { activo: true, usuario: { activo: true } },
      include: { usuario: { select: { nombres: true } }, horarios: true },
      orderBy: { id: 'asc' },
    }),
    prisma.horarioAtencion.findMany({ where: { odontologoId: null } }),
  ]);
  return lista.map((o) => {
    const tramos = o.horarios.length ? o.horarios : general;
    return { id: o.id, nombres: o.usuario.nombres, especialidad: o.especialidad, horario: tramos.length ? resumenHorario(tramos) : null };
  });
}
