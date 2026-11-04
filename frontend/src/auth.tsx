import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UsuarioSesion } from '@clinica/shared';
import { authApi } from './api/recursos';
import { EVENTO_SESION_VENCIDA } from './api/cliente';

interface Auth {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  setUsuario: (u: UsuarioSesion | null) => void;
  salir: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['yo'],
    queryFn: () => authApi.yo().catch(() => null),
    staleTime: Infinity,
  });
  const setUsuario = (u: UsuarioSesion | null) => qc.setQueryData(['yo'], u);
  // Primero se marca «sin usuario» (las rutas protegidas llevan al login) y luego se borran los datos
  // del usuario anterior. Antes se vaciaba toda la caché primero y la pantalla no se enteraba del cambio.
  const olvidarUsuario = useCallback(() => {
    qc.setQueryData(['yo'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'yo' });
  }, [qc]);
  const salir = async () => {
    await authApi.logout().catch(() => undefined);
    olvidarUsuario();
  };
  // Sesión vencida (15 min sin uso, RNF05): cualquier 401 de la API lleva al login
  useEffect(() => {
    const alVencer = () => {
      if (qc.getQueryData(['yo'])) olvidarUsuario();
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, alVencer);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, alVencer);
  }, [qc, olvidarUsuario]);
  return <Ctx.Provider value={{ usuario: data ?? null, cargando: isLoading, setUsuario, salir }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
};

/** Usuario en sesión, o null si el componente se usa fuera de AuthProvider (p. ej. en pruebas). */
export const useUsuarioOpcional = () => useContext(Ctx)?.usuario ?? null;
