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
