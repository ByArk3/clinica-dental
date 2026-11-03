import type { ReactNode } from 'react';
import { Modal } from 'react-bootstrap';

interface Props {
  abierto: boolean;
  titulo: string;
  children: ReactNode;
  textoConfirmar: string;
  peligro?: boolean;
  procesando?: boolean;
  error?: string | null;
  onConfirmar: () => void;
  onCerrar: () => void;
}

export function ModalConfirmar({ abierto, titulo, children, textoConfirmar, peligro, procesando, error, onConfirmar, onCerrar }: Props) {
  return (
    <Modal show={abierto} onHide={onCerrar} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h5">{titulo}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {children}
        {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}
      </Modal.Body>
      <Modal.Footer>
        <button className="btn btn-outline-secondary" onClick={onCerrar}>Volver</button>
        <button className={`btn ${peligro ? 'btn-danger' : 'btn-acento'}`} disabled={procesando} onClick={onConfirmar}>
          {procesando ? 'Procesando…' : textoConfirmar}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
