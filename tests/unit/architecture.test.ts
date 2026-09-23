/**
 * Tests que protegen decisiones de arquitectura, no comportamiento.
 *
 * Viven fuera de `_core/` a propósito: necesitan leer el sistema de archivos,
 * y dentro de `_core/` eso está prohibido (ADR-001).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve(import.meta.dirname, '../../supabase/functions/_core');

/** Todos los `.ts` de `_core`, menos los generados. */
function coreFiles(dir = CORE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return coreFiles(full);
    if (extname(entry.name) !== '.ts') return [];
    if (entry.name === 'database.types.ts') return [];
    return [full];
  });
}

describe('ADR-007 — el dominio no conoce a ningún proveedor de IA', () => {
  // El linter no puede comprobar esto: no es un import ni un global, es una
  // mención en cualquier parte del texto. Ver SPEC-002, CA-8.
  const PROVIDERS = /gemini|openai|anthropic|\bgpt\b|googleapis/i;

  it('ningún archivo de _core menciona un proveedor', () => {
    const offenders = coreFiles()
      .filter((file) => PROVIDERS.test(readFileSync(file, 'utf8')))
      .map((file) => relative(CORE, file));

    expect(
      offenders,
      'El core solo debe conocer la interfaz AIProvider. El proveedor vive en _shared/ai/.',
    ).toEqual([]);
  });

  it('el escáner funciona de verdad', () => {
    // Sin esto, el test de arriba pasaría aunque no estuviera leyendo nada.
    expect(coreFiles().length).toBeGreaterThan(0);
    expect(PROVIDERS.test('const client = new GeminiProvider()')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-002 — el modelo por defecto no puede caducar', () => {
  // ┌─ POR QUÉ ESTE TEST EXISTE ───────────────────────────────────────────┐
  // │ El sistema estuvo sin generar ni una rutina porque el nombre del     │
  // │ modelo por defecto (`…-2.0-flash`) se retiró del proveedor. Todo el  │
  // │ código estaba bien y todos los tests pasaban: el fallo era que una   │
  // │ constante nuestra apuntaba a algo que dejó de existir fuera.         │
  // │                                                                      │
  // │ No se puede comprobar contra la red desde un test. Lo que SÍ se      │
  // │ puede comprobar es la propiedad que lo causó: un alias móvil no      │
  // │ caduca, un nombre con versión sí. Así que el defecto debe ser un     │
  // │ alias, y quien quiera fijar una versión usa `AI_MODEL`.              │
  // └──────────────────────────────────────────────────────────────────────┘
  const HANDLER = resolve(
    import.meta.dirname,
    '../../supabase/functions/generate-version/index.ts',
  );

  /** El literal del que tira `readDeps` cuando no hay `AI_MODEL`. */
  function porDefecto(): string {
    const ts = readFileSync(HANDLER, 'utf8');
    const match = /const DEFAULT_MODEL = '([^']+)'/.exec(ts);

    expect(match, 'DEFAULT_MODEL dejó de existir o cambió de forma').not.toBeNull();
    return match![1] as string;
  }

  it('el defecto es un alias, no una versión concreta', () => {
    expect(
      porDefecto(),
      'Un nombre con número de versión se retira y tumba la generación entera.',
    ).not.toMatch(/\d/);
  });

  it('y sigue siendo sobreescribible sin desplegar', () => {
    const ts = readFileSync(HANDLER, 'utf8');
    expect(ts).toContain("optionalEnv('AI_MODEL')");
  });
});

describe('el adaptador llama a las funciones SQL por su nombre real', () => {
  // ┌─ EL BUG QUE ESTO CIERRA ───────────────────────────────────────────────┐
  // │ `db.ts` llamaba a `apply_version_transition` con `p_next_state`, y la  │
  // │ función declara `p_new_state`. PostgREST resuelve por nombre de        │
  // │ argumento: no encontraba ninguna función con esa firma y devolvía      │
  // │ PGRST202.                                                              │
  // │                                                                        │
  // │ NINGUNA transición de estado funcionaba —generar, aprobar, enviar—, y  │
  // │ los tests de las dos capas pasaban: el SQL es correcto, el TypeScript  │
  // │ es correcto, y nadie comprobaba que los nombres coincidieran.          │
  // └────────────────────────────────────────────────────────────────────────┘
  const MIGRATIONS = resolve(import.meta.dirname, '../../supabase/migrations');
  const ADAPTER = resolve(import.meta.dirname, '../../supabase/functions/_shared/db.ts');

  /**
   * Los parámetros de cada función SQL, según su definición MÁS RECIENTE.
   *
   * Las funciones se recrean en migraciones posteriores, así que gana la
   * última: comparar contra la original daría falsos positivos en cuanto
   * alguien añade un parámetro.
   */
  function parametrosDeclarados(): Map<string, Set<string>> {
    const porFuncion = new Map<string, Set<string>>();

    for (const file of readdirSync(MIGRATIONS).filter((f) => extname(f) === '.sql').toSorted()) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      const definiciones = sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(([^)]*)\)/gi,
      );

      for (const [, nombre, firma] of definiciones) {
        const params = [...(firma ?? '').matchAll(/\b(p_\w+)/g)].map(([, p]) => p as string);
        porFuncion.set(nombre as string, new Set(params));
      }
    }

    return porFuncion;
  }

  /** Cada llamada del adaptador, con los nombres de argumento que usa. */
  function llamadas(): { fn: string; args: string[]; linea: number }[] {
    const ts = readFileSync(ADAPTER, 'utf8');
    const lineaDe = (index: number): number => ts.slice(0, index).split('\n').length;

    // Dos formas: `.rpc('fn', { … })` y el ayudante `readDelivery(db, 'fn', { … })`.
    const patron = /(?:\.rpc\(\s*|readDelivery\(\s*db\s*,\s*)'(\w+)'\s*,\s*\{([^}]*)\}/g;

    return [...ts.matchAll(patron)].map((match) => ({
      fn: match[1] as string,
      args: [...(match[2] ?? '').matchAll(/(p_\w+)\s*:/g)].map(([, a]) => a as string),
      linea: lineaDe(match.index),
    }));
  }

  it('cada argumento existe en la función que dice llamar', () => {
    const declarados = parametrosDeclarados();

    const desajustes = llamadas().flatMap(({ fn, args, linea }) => {
      const params = declarados.get(fn);
      if (params === undefined) return [`db.ts:${linea} — no existe la función ${fn}()`];

      return args
        .filter((arg) => !params.has(arg))
        .map((arg) => `db.ts:${linea} — ${fn}() no tiene ningún ${arg}`);
    });

    expect(desajustes).toEqual([]);
  });

  it('y el propio test encuentra las llamadas: si deja de verlas, no protege nada', () => {
    // Un regex que deje de casar convertiría este archivo en decoración.
    expect(llamadas().length).toBeGreaterThan(5);
  });
});
