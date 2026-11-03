import { useAuth } from '../auth';

/** Inicio para los roles cuyos módulos llegan en iteraciones posteriores. */
export default function Inicio() {
  const { usuario } = useAuth();
  return (
    <div className="tarjeta">
      <h1 className="h4">Bienvenido(a), {usuario?.nombres}</h1>
      <p className="text-muted mb-0">Los módulos marcados como «próx.» en el menú se habilitan en las siguientes iteraciones.</p>
    </div>
  );
}
