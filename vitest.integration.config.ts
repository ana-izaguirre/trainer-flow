import { defineConfig } from 'vitest/config';

/**
 * Tests de integración: requieren un PostgreSQL accesible.
 *
 * Corren en serie porque comparten la base de datos.
 * Ver docs/TESTING.md.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
