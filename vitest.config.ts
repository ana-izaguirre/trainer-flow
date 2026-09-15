import { defineConfig } from 'vitest/config';

/**
 * Tests unitarios: solo `_core/`, que es TypeScript puro.
 * No necesitan base de datos ni red, y corren en milisegundos.
 *
 * Los tests de integración van en vitest.integration.config.ts.
 * Ver docs/TESTING.md.
 */
export default defineConfig({
  test: {
    include: ['supabase/functions/_core/**/*.test.ts'],
    environment: 'node',
    // _core/ está vacío hasta S-05 (máquina de estados).
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_core/**/*.ts'],
      exclude: [
        'supabase/functions/_core/**/*.test.ts',
        'supabase/functions/_core/database.types.ts',
      ],
      thresholds: {
        // La máquina de estados sostiene el principio del producto:
        // ninguna rutina llega al cliente sin aprobación humana.
        // Ver docs/TESTING.md, regla 3.
        'supabase/functions/_core/state-machine.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
