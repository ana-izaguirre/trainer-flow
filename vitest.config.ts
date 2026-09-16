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
      // `json-summary` lo exige la acción que comenta la cobertura en el PR.
      // `json` añade el detalle por archivo con las líneas sin cubrir.
      reporter: ['text', 'json-summary', 'json'],
      // Se reporta siempre, también cuando no se ejecutó ningún test del archivo.
      reportOnFailure: true,
      include: ['supabase/functions/_core/**/*.ts'],
      exclude: [
        'supabase/functions/_core/**/*.test.ts',
        'supabase/functions/_core/database.types.ts',
      ],
      thresholds: {
        // El proyecto está al 100% hoy. Fijarlo como umbral global convierte
        // "cobertura del 100%" de una afirmación del README en algo que el CI
        // hace cumplir. Los umbrales por archivo de abajo son redundantes con
        // este, pero documentan cuáles importan y por qué.
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,

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
