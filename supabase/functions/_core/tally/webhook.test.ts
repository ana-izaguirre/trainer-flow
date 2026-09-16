/**
 * SPEC-001 — El flujo del webhook de Tally.
 *
 * Lo que este módulo garantiza no es qué se guarda, sino **en qué orden**:
 * la firma antes de tocar nada, y el evento reclamado antes de trabajar.
 */
import { describe, expect, it } from 'vitest';
import type { SignatureVerifier, TallyRepo } from '../ports/tally-ports.ts';
import { handleTallyWebhook, outcomeToStatus } from './webhook.ts';

const CUERPO = JSON.stringify({
  eventId: 'evt-1',
  eventType: 'FORM_RESPONSE',
  data: {
    responseId: 'resp-1',
    formId: 'form-1',
    submissionPdfUrl: 'https://api.tally.so/x?accessToken=SECRETO',
    submissionPreviewUrl: 'https://tally.so/y?accessToken=SECRETO',
    fields: [{ key: 'k', label: 'Nombre', type: 'INPUT_TEXT', value: 'Ana' }],
  },
});

interface Espia {
  readonly deps: Parameters<typeof handleTallyWebhook>[1];
  readonly llamadas: string[];
  readonly guardado: unknown[];
}

function espia(
  opciones: { firmaValida?: boolean; yaVisto?: boolean; revienta?: 'error' | 'otra-cosa' } = {},
): Espia {
  const llamadas: string[] = [];
  const guardado: unknown[] = [];

  const verifier: SignatureVerifier = {
    matches: () => {
      llamadas.push('matches');
      return Promise.resolve(opciones.firmaValida ?? true);
    },
  };

  const repo: TallyRepo = {
    claimEvent: (externalId, payload) => {
      llamadas.push(`claimEvent:${externalId}`);
      guardado.push(payload);
      if (opciones.revienta === 'error') throw new Error('la base no responde');
      // Una librería puede lanzar algo que no es un Error. Si el flujo
      // supusiera que siempre lo es, el mensaje saldría como `undefined`.
      if (opciones.revienta === 'otra-cosa') throw 'un string pelado';
      return Promise.resolve(!(opciones.yaVisto ?? false));
    },
    markProcessed: (externalId) => {
      llamadas.push(`markProcessed:${externalId}`);
      return Promise.resolve();
    },
  };

  return { deps: { repo, verifier, requestId: 'req-1' }, llamadas, guardado };
}

const entrada = (overrides: Partial<{ rawBody: string; signature: string | null }> = {}) => ({
  rawBody: CUERPO,
  signature: 'firma',
  ...overrides,
});

// ---------------------------------------------------------------------------

describe('la firma va primero', () => {
  it('una firma inválida no toca la base', async () => {
    const { deps, llamadas } = espia({ firmaValida: false });

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome.kind).toBe('unauthorized');
    expect(llamadas).toEqual(['matches']);
  });

  it('sin cabecera de firma tampoco pasa', async () => {
    const { deps, llamadas } = espia();

    const outcome = await handleTallyWebhook(entrada({ signature: null }), deps);

    expect(outcome.kind).toBe('unauthorized');
    // Ni siquiera se calcula el HMAC: no hay nada contra qué compararlo.
    expect(llamadas).toEqual([]);
  });

  it('un cuerpo ilegible se rechaza DESPUÉS de la firma, no antes', async () => {
    // Al revés, alguien sin la clave podría distinguir un cuerpo válido de
    // uno inválido por la respuesta.
    const { deps, llamadas } = espia({ firmaValida: false });

    const outcome = await handleTallyWebhook(entrada({ rawBody: 'no es json' }), deps);

    expect(outcome.kind).toBe('unauthorized');
    expect(llamadas).toEqual(['matches']);
  });
});

describe('el sobre es dato no confiable', () => {
  it('un cuerpo que no es JSON se rechaza como malformado', async () => {
    const { deps } = espia();
    const outcome = await handleTallyWebhook(entrada({ rawBody: '{{{' }), deps);
    expect(outcome.kind).toBe('malformed');
  });

  it('un evento que no es FORM_RESPONSE se ignora', async () => {
    const { deps, llamadas } = espia();
    const raw = JSON.stringify({ eventId: 'e', eventType: 'OTRA_COSA', data: {} });

    const outcome = await handleTallyWebhook(entrada({ rawBody: raw }), deps);

    expect(outcome.kind).toBe('malformed');
    expect(llamadas).toEqual(['matches']);
  });
});

describe('idempotencia', () => {
  it('la primera entrega reclama el evento', async () => {
    const { deps, llamadas } = espia();

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome).toEqual({ kind: 'claimed', eventId: 'evt-1', formId: 'form-1' });
    expect(llamadas).toEqual(['matches', 'claimEvent:evt-1', 'markProcessed:evt-1']);
  });

  it('la segunda entrega del mismo eventId no hace nada más', async () => {
    const { deps, llamadas } = espia({ yaVisto: true });

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome).toEqual({ kind: 'duplicate', eventId: 'evt-1' });
    expect(llamadas).toEqual(['matches', 'claimEvent:evt-1']);
  });
});

describe('las URLs con credencial no llegan a la base', () => {
  it('se redactan antes de guardar el payload', async () => {
    // SPEC-001 regla 3: el raw_payload se guarda siempre, pero esas URLs
    // llevan un JWT dentro y guardarlas sería meter una credencial viva en
    // la base de datos.
    const { deps, guardado } = espia();

    await handleTallyWebhook(entrada(), deps);

    expect(JSON.stringify(guardado[0])).not.toContain('SECRETO');
  });

  it('el resto del payload se guarda intacto', async () => {
    const { deps, guardado } = espia();

    await handleTallyWebhook(entrada(), deps);

    const payload = guardado[0] as { data: { fields: unknown[]; responseId: string } };
    expect(payload.data.responseId).toBe('resp-1');
    expect(payload.data.fields).toHaveLength(1);
  });
});

describe('errores', () => {
  it('un fallo de la base devuelve `failed`, no una excepción', async () => {
    const { deps } = espia({ revienta: 'error' });

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome).toEqual({ kind: 'failed', message: 'la base no responde' });
  });

  it('algo que no es un Error también se convierte en `failed`', async () => {
    const { deps } = espia({ revienta: 'otra-cosa' });

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome).toEqual({ kind: 'failed', message: 'Error desconocido.' });
  });
});

describe('outcomeToStatus', () => {
  it.each([
    ['unauthorized', 401],
    ['malformed', 400],
    ['duplicate', 200],
    ['claimed', 200],
    ['failed', 500],
  ])('%s → %s', (kind, status) => {
    expect(outcomeToStatus({ kind } as never)).toBe(status);
  });

  it('500 en `failed` es a propósito: Tally reintenta y la idempotencia lo cubre', () => {
    expect(outcomeToStatus({ kind: 'failed', message: 'x' })).toBe(500);
  });
});
