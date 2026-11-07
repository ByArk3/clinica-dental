/** DNI del paciente o la etiqueta «DNI pendiente» (registrado sin DNI a la mano; se completa después). */
export function DniPaciente({ dni, prefijo = 'DNI ' }: { dni: string | null | undefined; prefijo?: string }) {
  if (dni) return <>{prefijo}{dni}</>;
  return (
    <span className="badge text-bg-warning" title="Registrado sin DNI: complételo cuando el paciente lo traiga">
      DNI pendiente
    </span>
  );
}
