import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pacientesApi } from '../api/recursos';
import { FormContacto } from '../components/FormContacto';
import { fechaPE, solesPE } from '../formato';

const fechaLima = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(iso));

/** CU-04 (paciente): actualizar sus datos de contacto. */
export default function MiPerfil() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['mi-perfil'], queryFn: pacientesApi.miPerfil });
  return (
    <>
      <h1 className="h4 mb-3">Mis datos</h1>
      {data && (
        <div className="tarjeta">
          <p className="mb-3"><strong>{data.nombres} {data.apellidos}</strong> · DNI {data.dni}</p>
          {Number(data.saldoFavor ?? 0) > 0 && (
            <div className="alert alert-success py-2">
              Tiene un saldo a favor de <strong>{solesPE(data.saldoFavor!)}</strong>: se usa solo en su próximo adelanto o cobro.
              {!!data.saldoVencimientos?.length && (
                <ul className="small mb-0 mt-1 ps-3">
                  {data.saldoVencimientos.map((v, i) => (
                    <li key={i}>{solesPE(v.monto)} vencen el {fechaPE(fechaLima(v.venceEn))}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <FormContacto
            paciente={data}
            onGuardar={async (d) => qc.setQueryData(['mi-perfil'], await pacientesApi.actualizarMiContacto(d))}
          />
        </div>
      )}
    </>
  );
}
