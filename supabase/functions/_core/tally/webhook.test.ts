/**
 * SPEC-001 — El flujo del webhook de Tally.
 *
 * Lo que este módulo garantiza no es qué se guarda, sino **en qué orden**:
 * la firma antes de tocar nada, y el evento reclamado antes de trabajar.
 */
import { describe, expect, it } from 'vitest';
import type { SignatureVerifier, TallyRepo } from '../ports/tally-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { handleTallyWebhook, outcomeToStatus } from './webhook.ts';

const CUERPO = JSON.stringify({
  eventId: 'evt-1',
  eventType: 'FORM_RESPONSE',
  data: {
    responseId: 'resp-1',
    formId: 'form-1',
    submissionPdfUrl: 'https://api.tally.so/x?accessToken=SECRETO',
    submissionPreviewUrl: 'https://tally.so/y?accessToken=SECRETO',
    fields: [
      { key: 'a', label: 'Nombre', type: 'INPUT_TEXT', value: 'Ana' },
      { key: 'b', label: 'Objetivo', type: 'MULTIPLE_CHOICE', value: 'Fuerza' },
      { key: 'c', label: 'Nivel', type: 'MULTIPLE_CHOICE', value: 'Principiante (menos de 6 meses)' },
      { key: 'd', label: '¿Cuántos días a la semana entrenas?', type: 'LINEAR_SCALE', value: 4 },
      { key: 'e', label: 'Tiempo por sesión', type: 'MULTIPLE_CHOICE', value: '45–60 minutos' },
      { key: 'f', label: 'Equipamiento disponible', type: 'CHECKBOXES', value: ['Mancuernas'] },
      { key: 'g', label: 'Lesiones, dolor o limitaciones', type: 'CHECKBOXES', value: ['Ninguna'] },
    ],
  },
});

interface Espia {
  readonly deps: Parameters<typeof handleTallyWebhook>[1];
  readonly llamadas: string[];
  readonly guardado: unknown[];
  readonly avisos: string[];
  readonly ingestado: unknown[];
}

function espia(
  opciones: {
    firmaValida?: boolean;
    yaVisto?: boolean;
    revienta?: 'error' | 'otra-cosa';
    sinEntrenador?: boolean;
  } = {},
): Espia {
  const llamadas: string[] = [];
  const guardado: unknown[] = [];
  const avisos: string[] = [];
  const ingestado: unknown[] = [];

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
    findTrainer: () => {
      llamadas.push('findTrainer');
      return Promise.resolve(
        (opciones.sinEntrenador ?? false) ? null : { profileId: 'perfil-1', chatId: 99 },
      );
    },
    ingestAssessment: (input) => {
      llamadas.push('ingestAssessment');
      ingestado.push(input);
      return Promise.resolve({ clientId: 'c1', planId: 'p1', versionId: 'v1' });
    },
  };

  const sender: TelegramSender = {
    sendMessage: (chatId, text) => {
      avisos.push(`${chatId}:${text}`);
      return Promise.resolve();
    },
    answerCallback: () => Promise.resolve(),
  };

  return {
    deps: { repo, verifier, sender, newLinkToken: () => 'token-de-32-caracteres-exactos-x', requestId: 'req-1' },
    llamadas,
    guardado,
    avisos,
    ingestado,
  };
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

    expect(outcome).toEqual({
      kind: 'ingested',
      eventId: 'evt-1',
      clientId: 'c1',
      planId: 'p1',
      versionId: 'v1',
    });
    expect(llamadas).toEqual([
      'matches',
      'findTrainer',
      'claimEvent:evt-1',
      'ingestAssessment',
      'markProcessed:evt-1',
    ]);
  });

  it('la segunda entrega del mismo eventId no hace nada más', async () => {
    const { deps, llamadas } = espia({ yaVisto: true });

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome).toEqual({ kind: 'duplicate', eventId: 'evt-1' });
    expect(llamadas).toEqual(['matches', 'findTrainer', 'claimEvent:evt-1']);
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
    expect(payload.data.fields).toHaveLength(7);
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
    ['ingested', 200],
    ['invalid', 200],
    ['failed', 500],
  ])('%s → %s', (kind, status) => {
    expect(outcomeToStatus({ kind } as never)).toBe(status);
  });

  it('500 en `failed` es a propósito: Tally reintenta y la idempotencia lo cubre', () => {
    expect(outcomeToStatus({ kind: 'failed', message: 'x' })).toBe(500);
  });
});

// ---------------------------------------------------------------------------

describe('la escritura', () => {
  it('crea las cuatro filas con lo que validó el dominio', async () => {
    const { deps, ingestado } = espia();

    await handleTallyWebhook(entrada(), deps);

    expect(ingestado[0]).toMatchObject({
      trainerId: 'perfil-1',
      fullName: 'Ana',
      goal: 'Fuerza',
      // El formulario dijo «Principiante (menos de 6 meses)».
      level: 'beginner',
      daysPerWeek: 4,
      // «45–60 minutos» → el extremo bajo.
      sessionMinutes: 45,
      equipment: 'Mancuernas',
      hasLimitations: false,
    });
  });

  it('el link_token lo genera quien tiene crypto, no el dominio', async () => {
    const { deps, ingestado } = espia();

    await handleTallyWebhook(entrada(), deps);

    expect(ingestado[0]).toMatchObject({ linkToken: 'token-de-32-caracteres-exactos-x' });
  });

  it('guarda el payload YA redactado, no el original', async () => {
    const { deps, ingestado } = espia();

    await handleTallyWebhook(entrada(), deps);

    expect(JSON.stringify(ingestado[0])).not.toContain('SECRETO');
  });
});

describe('sin entrenador registrado', () => {
  it('no reclama el evento: Tally reintenta y el envío no se pierde', async () => {
    // Al revés, el evento quedaría marcado como procesado sin haber creado
    // nada, y ese envío no volvería jamás.
    const { deps, llamadas } = espia({ sinEntrenador: true });

    const outcome = await handleTallyWebhook(entrada(), deps);

    expect(outcome.kind).toBe('failed');
    expect(llamadas).toEqual(['matches', 'findTrainer']);
    expect(outcomeToStatus(outcome)).toBe(500);
  });
});

/** Un sobre bien formado cuyas respuestas no alcanzan para una evaluación. */
const SIN_NIVEL = JSON.stringify({
  eventId: 'evt-2',
  eventType: 'FORM_RESPONSE',
  data: {
    responseId: 'r',
    formId: 'f',
    fields: [{ key: 'a', label: 'Nombre', type: 'INPUT_TEXT', value: 'Ana' }],
  },
});

describe('una evaluación que no se puede leer', () => {
  it('avisa al entrenador en vez de perder el envío (regla 9)', async () => {
    const { deps, avisos, llamadas } = espia();

    const outcome = await handleTallyWebhook(entrada({ rawBody: SIN_NIVEL }), deps);

    expect(outcome.kind).toBe('invalid');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('99:');
    // El payload se guardó igual: `claimEvent` corrió antes de validar.
    expect(llamadas).toContain('claimEvent:evt-2');
    expect(llamadas).toContain('markProcessed:evt-2');
    expect(llamadas).not.toContain('ingestAssessment');
  });

  it('el aviso lleva los NOMBRES de los campos, nunca sus valores', async () => {
    // Uno de esos campos puede ser información de salud.
    const { deps, avisos } = espia();

    const outcome = await handleTallyWebhook(entrada({ rawBody: SIN_NIVEL }), deps);

    expect(outcome.kind).toBe('invalid');
    if (outcome.kind !== 'invalid') return;

    expect(outcome.fields).toContain('level');
    for (const campo of outcome.fields) expect(avisos[0]).toContain(campo);
    expect(avisos[0]).not.toContain('Ana');
  });

  it('responde 200: reintentar no la haría válida', async () => {
    const { deps } = espia();
    const outcome = await handleTallyWebhook(entrada({ rawBody: SIN_NIVEL }), deps);
    expect(outcomeToStatus(outcome)).toBe(200);
  });
});
