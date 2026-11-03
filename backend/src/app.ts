import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import helmet from 'helmet';
import cors from 'cors';
import { rutas } from './routes/index.js';
import { manejadorErrores } from './middlewares/errores.js';

const QUINCE_MINUTOS = 15 * 60 * 1000; // RNF05

export function crearApp() {
  const app = express();
  const produccion = process.env.NODE_ENV === 'production';
  if (produccion) app.set('trust proxy', 1);

  app.use(helmet()); // RNF06
  app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true })); // CORS solo al frontend
  app.use(express.json({ limit: '100kb' }));

  const PgStore = connectPg(session);
  app.use(
    session({
      name: 'sid',
      store: new PgStore({ conString: process.env.DATABASE_URL, tableName: 'session' }),
      secret: process.env.SESSION_SECRET ?? 'solo-desarrollo',
      resave: false,
      saveUninitialized: false,
      rolling: true, // expiración deslizante: 15 min desde la última petición
      cookie: { httpOnly: true, sameSite: 'lax', secure: produccion, maxAge: QUINCE_MINUTOS },
    }),
  );

  app.get('/api/salud', (_req, res) => res.json({ ok: true }));
  app.use('/api', rutas);
  app.use('/api', (_req, res) => res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'Recurso no encontrado' }));
  app.use(manejadorErrores);
  return app;
}
