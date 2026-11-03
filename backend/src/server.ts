import 'dotenv/config';
import { crearApp } from './app.js';
import { iniciarTareas } from './jobs/index.js';

const puerto = Number(process.env.PORT ?? 3000);
crearApp().listen(puerto, () => console.info(`API de la Clínica Dental en http://localhost:${puerto}/api`));
if (process.env.JOBS_ENABLED === 'true') iniciarTareas();
