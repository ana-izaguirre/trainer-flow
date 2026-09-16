/**
 * SPEC-003 — Parsing de los updates de Telegram.
 *
 * Un update es dato NO confiable: llega por HTTP desde fuera. Se valida igual
 * de estricto que una respuesta de la IA.
 */
import { describe, expect, it } from 'vitest';
import { parseUpdate } from './update.ts';

const FROM = { id: 500, first_name: 'Ana' };

function mensaje(text: string, chatId = 500) {
  return { update_id: 1, message: { message_id: 9, from: FROM, chat: { id: chatId }, text } };
}

describe('comandos', () => {
  it('reconoce un comando sin argumentos', () => {
    const result = parseUpdate(mensaje('/clientes'));

    expect(result).toEqual({
      kind: 'command',
      updateId: 1,
      telegramUserId: 500,
      chatId: 500,
      messageId: 9,
      command: 'clientes',
      args: '',
    });
  });

  it('separa el comando de sus argumentos', () => {
    const result = parseUpdate(mensaje('/cliente Carlos Pérez'));

    expect(result).toMatchObject({ kind: 'command', command: 'cliente', args: 'Carlos Pérez' });
  });

  it('normaliza el comando a minúsculas', () => {
    expect(parseUpdate(mensaje('/CLIENTES'))).toMatchObject({ command: 'clientes' });
  });

  it('quita el sufijo @bot que añade Telegram en grupos', () => {
    expect(parseUpdate(mensaje('/clientes@TrainerFlowBot'))).toMatchObject({
      command: 'clientes',
      args: '',
    });
  });

  it('captura el token del deep link en /start', () => {
    expect(parseUpdate(mensaje('/start abc123token'))).toMatchObject({
      command: 'start',
      args: 'abc123token',
    });
  });

  it('recorta espacios sobrantes en los argumentos', () => {
    expect(parseUpdate(mensaje('/cliente    Carlos   '))).toMatchObject({ args: 'Carlos' });
  });
});

describe('texto plano', () => {
  it('lo reconoce como texto, no como comando', () => {
    expect(parseUpdate(mensaje('quita sentadilla'))).toMatchObject({
      kind: 'text',
      text: 'quita sentadilla',
    });
  });

  it('una barra a mitad de frase no lo convierte en comando', () => {
    expect(parseUpdate(mensaje('sets 3/4 semanas'))).toMatchObject({ kind: 'text' });
  });
});

describe('callback_query', () => {
  it('lo reconoce con su id y sus datos', () => {
    const result = parseUpdate({
      update_id: 7,
      callback_query: {
        id: 'cbq-1',
        from: FROM,
        data: 'act:approve:v1',
        message: { message_id: 42, chat: { id: 500 } },
      },
    });

    expect(result).toEqual({
      kind: 'callback',
      updateId: 7,
      telegramUserId: 500,
      chatId: 500,
      messageId: 42,
      callbackQueryId: 'cbq-1',
      data: 'act:approve:v1',
    });
  });
});

describe('updates que se ignoran', () => {
  it.each([
    ['sin update_id', { message: { from: FROM, chat: { id: 1 }, text: 'hola' } }],
    ['sin from', { update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: 'hola' } }],
    ['sin chat', { update_id: 1, message: { message_id: 1, from: FROM, text: 'hola' } }],
    ['tipo desconocido', { update_id: 1, poll: { id: 'p' } }],
    ['mensaje sin texto (una foto)', { update_id: 1, message: { message_id: 1, from: FROM, chat: { id: 1 } } }],
    ['callback sin mensaje asociado', { update_id: 1, callback_query: { id: 'c', from: FROM, data: 'x' } }],
    ['callback sin from', { update_id: 1, callback_query: { id: 'c', data: 'x', message: { message_id: 1, chat: { id: 1 } } } }],
    ['callback sin message_id', { update_id: 1, callback_query: { id: 'c', from: FROM, data: 'x', message: { chat: { id: 1 } } } }],
    ['callback sin id', { update_id: 1, callback_query: { from: FROM, data: 'x', message: { message_id: 1, chat: { id: 1 } } } }],
    ['callback con id vacío', { update_id: 1, callback_query: { id: '', from: FROM, data: 'x', message: { message_id: 1, chat: { id: 1 } } } }],
    ['callback sin data', { update_id: 1, callback_query: { id: 'c', from: FROM, message: { message_id: 1, chat: { id: 1 } } } }],
    ['callback con data vacía', { update_id: 1, callback_query: { id: 'c', from: FROM, data: '', message: { message_id: 1, chat: { id: 1 } } } }],
    ['mensaje sin message_id', { update_id: 1, message: { from: FROM, chat: { id: 1 }, text: 'hola' } }],
  ])('ignora un update %s', (_nombre, raw) => {
    expect(parseUpdate(raw).kind).toBe('ignored');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'hola'],
    ['número', 42],
    ['array', [1, 2]],
  ])('ignora una raíz que es %s', (_nombre, raw) => {
    expect(parseUpdate(raw).kind).toBe('ignored');
  });

  it('un update ignorado explica por qué', () => {
    const result = parseUpdate({ update_id: 1, poll: {} });
    expect(result.kind).toBe('ignored');
    if (result.kind === 'ignored') expect(result.reason.length).toBeGreaterThan(0);
  });

  it('conserva el update_id de un ignorado, para la idempotencia', () => {
    // Aunque no se procese, el evento se registra: si Telegram lo reintenta,
    // no se vuelve a evaluar.
    const result = parseUpdate({ update_id: 99, poll: {} });
    expect(result).toMatchObject({ kind: 'ignored', updateId: 99 });
  });
});

describe('límites y datos hostiles', () => {
  it('trunca un texto absurdamente largo', () => {
    const result = parseUpdate(mensaje('x'.repeat(10_000)));

    expect(result.kind).toBe('text');
    if (result.kind === 'text') expect(result.text.length).toBeLessThanOrEqual(4096);
  });

  it('ignora un update cuyo texto es solo espacios', () => {
    expect(parseUpdate(mensaje('    ')).kind).toBe('ignored');
  });

  it('ignora un update con una barra sola', () => {
    expect(parseUpdate(mensaje('/')).kind).toBe('ignored');
  });

  it('no se rompe con un from.id que no es número', () => {
    const raw = { update_id: 1, message: { message_id: 1, from: { id: 'x' }, chat: { id: 1 }, text: 'hola' } };
    expect(parseUpdate(raw).kind).toBe('ignored');
  });
});
