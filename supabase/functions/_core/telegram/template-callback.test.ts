/**
 * SPEC-008 §3 — el callback de elegir plantilla.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../templates.ts';
import { buildTemplateCallback, parseTemplateCallback } from './template-callback.ts';

const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

describe('ida y vuelta', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s se construye y se vuelve a leer', (id) => {
    expect(parseTemplateCallback(buildTemplateCallback(id, VERSION))).toEqual({
      templateId: id,
      versionId: VERSION,
    });
  });

  it('🔴 NINGUNA plantilla del catálogo pasa los 64 bytes', () => {
    // Pasarse no da error al construirlo: Telegram rechaza el mensaje entero
    // y el entrenador se queda sin botones sin saber por qué.
    for (const t of TEMPLATES) {
      const data = buildTemplateCallback(t.id, VERSION);
      expect(new TextEncoder().encode(data).length, t.id).toBeLessThanOrEqual(64);
    }
  });
});

describe('lo que no se acepta', () => {
  it.each([
    ['otro prefijo', `act:approve:${VERSION}`],
    ['un callback de check-in', `chk:feeling:good:${VERSION}`],
    ['sin versión', 'tpl:full-body-3d'],
    ['una versión que no es UUID', 'tpl:full-body-3d:no-soy-un-uuid'],
    ['un id con espacios', `tpl:full body:${VERSION}`],
    ['un id con caracteres raros', `tpl:<script>:${VERSION}`],
    ['vacío', ''],
  ])('rechaza %s', (_nombre, raw) => {
    expect(parseTemplateCallback(raw)).toBeNull();
  });

  it('un id con la forma correcta pero inventado se acepta AQUÍ', () => {
    // El parseo no valida el catálogo: eso lo hace `findTemplate` después.
    // Separarlo evita tener la lista de plantillas en dos sitios.
    expect(parseTemplateCallback(`tpl:no-existe-esta:${VERSION}`)).toEqual({
      templateId: 'no-existe-esta',
      versionId: VERSION,
    });
  });
});
