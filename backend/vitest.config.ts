import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Las pruebas SIEMPRE usan la base de pruebas (.env.test), también con «npx vitest …»:
// así nunca se vacía la base de desarrollo por error.
config({ path: '.env.test', override: true });

export default defineConfig({
  test: {
    environment: 'node',
    // Las pruebas comparten una sola base de datos de prueba: correr en serie
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
