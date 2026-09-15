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
    include: [
      'supabase/functions/_core/**/*.test.ts',
      // Tests sobre la arquitectura: leen archivos, así que no pueden vivir
      // dentro de _core (ADR-001).
      'tests/unit/**/*.test.ts',
    ],
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
        // Estos dos módulos sostienen las garantías del sistema y por eso
        // exigen cobertura total. Ver docs/TESTING.md y ADR-010.
        //
        //   authorization.ts  → con RLS en denegación total, es LO ÚNICO que
        //                       separa a un cliente de los datos de otro.
        //   state-machine.ts  → hace imposible que una rutina llegue al
        //                       cliente sin aprobación humana.
        //   validate-draft.ts → la frontera con la IA: nada entra al dominio
        //                       sin pasar por aquí.
        'supabase/functions/_core/authorization.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'supabase/functions/_core/domain/state-machine.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Frontera con la IA: todo lo que entra aquí es dato no confiable.
        'supabase/functions/_core/domain/validate-draft.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
