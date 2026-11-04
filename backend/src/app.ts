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
  // Detrás de nginx (Docker) o de un balanceador: confiar en X-Forwarded-*
  if (produccion || process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  // RNF06: cookie `secure` (solo HTTPS) en producción. COOKIE_SECURE=false permite probar por HTTP en local.
  const cookieSegura = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : produccion;

  app.use(helmet()); // RNF06
  app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true })); // CORS solo al frontend
  // JSON de hasta 100 KB; el pago del adelanto (con captura) y el QR de pago tienen su propio límite de 3 MB
  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (/^\/api\/(citas\/\d+\/pago|admin\/pago\/qr)$/.test(req.path) ? next() : json(req, res, next)));

  const PgStore = connectPg(session);
  app.use(
    session({
      name: 'sid',
      store: new PgStore({ conString: process.env.DATABASE_URL, tableName: 'session' }),
      secret: process.env.SESSION_SECRET ?? 'solo-desarrollo',
      resave: false,
      saveUninitialized: false,
      rolling: true, // expiración deslizante: 15 min desde la última petición
      cookie: { httpOnly: true, sameSite: 'lax', secure: cookieSegura, maxAge: QUINCE_MINUTOS },
    }),
  );

  app.get('/api/salud', (_req, res) => res.json({ ok: true }));
  app.use('/api', rutas);
  app.use('/api', (_req, res) => res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'Recurso no encontrado' }));
  app.use(manejadorErrores);
  return app;
}
