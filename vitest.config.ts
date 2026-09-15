import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Solo se prueba _core/ (TypeScript puro) y tests/.
    // Las funciones de Deno no se prueban con Vitest: ver docs/TESTING.md.
    include: [
      'supabase/functions/_core/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_core/**/*.ts'],
      exclude: [
        'supabase/functions/_core/**/*.test.ts',
        'supabase/functions/_core/database.types.ts',
      ],
      thresholds: {
        // La máquina de estados sostiene el principio del producto.
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
