import { defineConfig } from 'vitest/config';

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
