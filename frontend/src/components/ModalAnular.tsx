import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motivoSchema, LIMITE_TEXTO } from '@clinica/shared';
import { cajaApi, type Comprobante } from '../api/recursos';
import { ModalConfirmar } from './ModalConfirmar';
import { mensajeError, solesPE } from '../formato';
import { Contador } from './Interaccion';

interface Props {
  comprobante: { id: number; numero: string; tipo: 'servicio' | 'adelanto'; total: string; paciente: string } | null;
  onCerrar: () => void;
  onAnulado?: (c: Comprobante) => void;
}

/** Anular un comprobante emitido por error: pide el motivo y explica qué pasará. */
export function ModalAnular({ comprobante, onCerrar, onAnulado }: Props) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const anular = useMutation({
    mutationFn: () => cajaApi.anular(comprobante!.id, motivo.trim()),
    onSuccess: (c) => {
      for (const k of ['caja-comprobantes', 'caja-pendientes', 'rep-ingresos', 'panel']) qc.invalidateQueries({ queryKey: [k] });
      onAnulado?.(c);
      cerrar();
    },
  });
  function cerrar() {
    setMotivo('');
    setError(null);
    anular.reset();
    onCerrar();
  }
  function confirmar() {
    const v = motivoSchema.safeParse({ motivo });
    if (!v.success) return setError(v.error.issues[0].message);
    setError(null);
    anular.mutate();
  }
  const c = comprobante;
  return (
    <ModalConfirmar
      abierto={!!c}
      titulo={`Anular comprobante ${c?.numero ?? ''}`}
      textoConfirmar="Anular comprobante"
      peligro
      procesando={anular.isPending}
      error={anular.isError ? mensajeError(anular.error) : null}
      onConfirmar={confirmar}
      onCerrar={cerrar}
    >
      {c && (
        <>
          <p className="mb-2">
            {c.paciente} · <strong>{solesPE(c.total)}</strong>
          </p>
          <ul className="small text-muted ps-3">
            <li>El comprobante no se borra: conserva su número, queda marcado «Anulado» y ya no cuenta en los ingresos.</li>
            {c.tipo === 'servicio' ? (
              <li>La cita vuelve a «Atendida» para cobrarla de nuevo. El saldo a favor que usó vuelve al paciente y el que generó se retira.</li>
            ) : (
              <li>Si la cita aún no ocurre, vuelve a «Pendiente de adelanto» con 1 hora para pagar.</li>
            )}
            <li>Si corresponde, devuelva el dinero al paciente o cobre el monto correcto.</li>
          </ul>
          <label htmlFor="motivo-anular" className="form-label">Motivo *</label>
          <textarea
            id="motivo-anular"
            rows={2}
            className={`form-control ${error ? 'is-invalid' : ''}`}
            placeholder="p. ej. Se cobró el tratamiento equivocado"
            value={motivo}
            maxLength={LIMITE_TEXTO.motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="invalid-feedback">{error}</div>
          <Contador valor={motivo} max={LIMITE_TEXTO.motivo} />
        </>
      )}
    </ModalConfirmar>
  );
}
