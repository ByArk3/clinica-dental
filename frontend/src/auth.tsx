import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UsuarioSesion } from '@clinica/shared';
import { authApi } from './api/recursos';

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
  const salir = async () => {
    await authApi.logout().catch(() => undefined);
    qc.clear();
    setUsuario(null);
  };
  return <Ctx.Provider value={{ usuario: data ?? null, cargando: isLoading, setUsuario, salir }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
};
