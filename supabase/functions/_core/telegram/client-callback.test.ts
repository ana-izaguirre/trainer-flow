/**
 * SPEC-022 M4 — El botón que abre la ficha de UN cliente, cuando `/cliente`
 * encontró varios.
 */
import { describe, expect, it } from 'vitest';
import { buildClientCallback, parseClientCallback } from './client-callback.ts';

const CLIENTE = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

describe('cli:<clientId>', () => {
  it('ida y vuelta', () => {
    expect(parseClientCallback(buildClientCallback(CLIENTE))).toEqual({ clientId: CLIENTE });
  });

  it('cabe en los 64 bytes de Telegram (ocupa 40)', () => {
    const data = buildClientCallback(CLIENTE);
    expect(new TextEncoder().encode(data).length).toBe(40);
  });

  it('el UUID se normaliza a minúsculas', () => {
    expect(parseClientCallback(`cli:${CLIENTE.toUpperCase()}`)).toEqual({ clientId: CLIENTE });
  });

  // El `callback_data` es dato no confiable: cualquiera puede fabricar uno.
  it.each([
    ['vacío', ''],
    ['solo el prefijo', 'cli:'],
    ['un id que no es UUID', 'cli:carlos'],
    ['un UUID con algo detrás', `cli:${CLIENTE}:extra`],
    ['otro prefijo', `act:approve:${CLIENTE}`],
    ['el de una plantilla', `tpl:full-body-3d:${CLIENTE}`],
    ['con espacios', ` cli:${CLIENTE}`],
  ])('%s → null', (_caso, raw) => {
    expect(parseClientCallback(raw)).toBeNull();
  });
});
