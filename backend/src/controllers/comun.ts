import type { Request } from 'express';
import { z } from 'zod';

export const idParam = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);

/** ?activo=1|0|true|false → boolean | undefined */
export const boolQuery = (v: unknown) =>
  v === undefined || v === '' ? undefined : v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : undefined;

export const textoQuery = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined);
