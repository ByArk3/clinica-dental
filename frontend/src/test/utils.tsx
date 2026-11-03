import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

export function renderizar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

type Respuesta = { status?: number; body?: unknown };
/** Simula la API: cada clave es "MÉTODO /ruta-sin-query" y su valor una respuesta o una lista (en orden). */
export function simularApi(rutas: Record<string, Respuesta | Respuesta[]>) {
  const llamadas: { metodo: string; url: string; body?: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const metodo = init?.method ?? 'GET';
    llamadas.push({ metodo, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const clave = `${metodo} ${url.replace(/^\/api/, '').split('?')[0]}`;
    let r = rutas[clave];
    if (Array.isArray(r)) r = r.length > 1 ? r.shift()! : r[0];
    if (!r) return new Response(JSON.stringify({ codigo: 'X', mensaje: `sin simular: ${clave}` }), { status: 500 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  return llamadas;
}
