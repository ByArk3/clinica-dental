import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pacientesApi } from '../api/recursos';
import { FormContacto } from '../components/FormContacto';
import { solesPE } from '../formato';

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
            <div className="alert alert-success py-2">Tiene un saldo a favor de <strong>{solesPE(data.saldoFavor!)}</strong>: se descontará en su próximo cobro.</div>
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
