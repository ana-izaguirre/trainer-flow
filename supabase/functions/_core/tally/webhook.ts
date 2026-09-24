/**
 * El flujo del webhook de Tally, sin HTTP.
 *
 * Mismo contrato que el de Telegram (ADR-011): este módulo decide QUÉ PASÓ y
 * la Edge Function traduce eso a un código de estado. A cambio, todo el flujo
 * se prueba sin levantar un servidor.
 *
 * El ORDEN de los pasos es lo que este módulo garantiza:
 *
 *   1. Verificar la firma  → antes de tocar absolutamente nada
 *   2. Parsear el sobre    → dato no confiable
 *   3. Buscar al entrenador→ sin él no hay dónde colgar el cliente
 *   4. Reclamar el evento  → idempotencia
 *   5. Mapear y validar    → configuración + reglas del dominio
 *   6. Escribir, o avisar  → las cuatro filas, o el aviso al entrenador
 *
 * El paso 1 va primero **incluso antes de mirar si el cuerpo es JSON**. Al
 * revés, alguien sin la clave podría distinguir un cuerpo válido de uno
 * inválido por la respuesta que recibe.
 *
 * El paso 3 va ANTES del 4 a propósito: si no hay entrenador todavía, no se
 * reclama el evento. Así Tally reintenta y el envío no se pierde, en vez de
 * quedar marcado como procesado sin haber creado nada.
 */
import { mapFormFields } from '../assessment/field-mapping.ts';
import { TALLY_MAPPING } from '../assessment/mapping.ts';
import { parseTallyEnvelope, redactCredentialUrls } from '../assessment/tally-envelope.ts';
import { validateAssessment } from '../assessment/validate-assessment.ts';
import type { SignatureVerifier, TallyRepo } from '../ports/tally-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildAssessmentArrived } from '../telegram/notify.ts';
import { buildDeepLink } from '../telegram/start.ts';

export type TallyOutcome =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'malformed'; readonly reason: string }
  | { readonly kind: 'duplicate'; readonly eventId: string }
  | {
      readonly kind: 'ingested';
      readonly eventId: string;
      readonly clientId: string;
      readonly planId: string;
      readonly versionId: string;
      /**
       * Campos del mapeo que el formulario no traía (SPEC-016 regla 2).
       *
       * Son NOMBRES, nunca valores: el handler loguea el outcome entero.
       * Si aquí sale `age` y la pregunta existe en Tally, la etiqueta de
       * `mapping.ts` no coincide y el dato se está perdiendo en silencio.
       */
      readonly camposAusentes: readonly string[];
    }
  /**
   * El sobre estaba bien pero las respuestas no. El evento queda guardado y
   * el entrenador recibe un aviso: el dato no se pierde (regla 9).
   *
   * `fields` son NOMBRES de campo, nunca sus valores: uno de ellos puede ser
   * información de salud.
   */
  | { readonly kind: 'invalid'; readonly eventId: string; readonly fields: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

export interface TallyInput {
  /**
   * El cuerpo **sin parsear**. La firma se calcula sobre estos bytes exactos:
   * volver a serializar el JSON cambiaría espacios y orden, y el HMAC ya no
   * cuadraría.
   */
  readonly rawBody: string;
  readonly signature: string | null;
}

export interface TallyDeps {
  readonly repo: TallyRepo;
  readonly verifier: SignatureVerifier;
  readonly sender: TelegramSender;
  /** 32 bytes de CSPRNG en base64url. Lo genera `_shared`: `_core` no tiene crypto. */
  readonly newLinkToken: () => string;
  /**
   * El usuario del bot, sin `@`. Con él se arma el enlace de vinculación que
   * el entrenador le reenvía al cliente (SPEC-014).
   *
   * Entra por dependencia y no se lee del entorno: `_core` no toca `Deno.env`.
   */
  readonly botUsername: string;
  readonly requestId: string;
}

/**
 * Traduce el resultado a un código HTTP.
 *
 * `failed` devuelve **500 a propósito**: Tally reintenta, y la idempotencia
 * hace que el reintento sea seguro. Es lo contrario que en Telegram, donde un
 * 500 provocaría un bucle sobre un update que nunca va a procesarse bien.
 */
export function outcomeToStatus(outcome: TallyOutcome): number {
  switch (outcome.kind) {
    case 'unauthorized':
      return 401;
    case 'malformed':
      return 400;
    case 'failed':
      return 500;
    default:
      return 200;
  }
}

export async function handleTallyWebhook(
  input: TallyInput,
  deps: TallyDeps,
): Promise<TallyOutcome> {
  // ── 1. La firma, antes de tocar nada ───────────────────────────────────
  if (input.signature === null) return { kind: 'unauthorized' };
  if (!(await deps.verifier.matches(input.rawBody, input.signature))) {
    return { kind: 'unauthorized' };
  }

  // ── 2. El sobre es dato no confiable ───────────────────────────────────
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { kind: 'malformed', reason: 'El cuerpo no es JSON.' };
  }

  const sobre = parseTallyEnvelope(body);
  if (!sobre.ok) return { kind: 'malformed', reason: sobre.error };

  const { eventId } = sobre.value;
  const rawPayload = redactCredentialUrls(body);

  try {
    // ── 3. El entrenador, antes de reclamar ──────────────────────────────
    // Sin él no hay dónde colgar el cliente, y reclamar el evento lo daría
    // por procesado para siempre. Devolver `failed` hace que Tally reintente.
    const trainer = await deps.repo.findTrainer();
    if (trainer === null) {
      return { kind: 'failed', message: 'Todavía no hay un entrenador registrado.' };
    }

    // ── 4. Idempotencia ──────────────────────────────────────────────────
    const isNew = await deps.repo.claimEvent(eventId, rawPayload, deps.requestId);
    if (!isNew) return { kind: 'duplicate', eventId };

    // ── 5. Del formulario al dominio ─────────────────────────────────────
    const mapeados = mapFormFields(sobre.value.fields, TALLY_MAPPING);

    // `mapFormFields` omite lo que no encontró, así que la diferencia con el
    // mapeo son las etiquetas que no cuadraron.
    //
    // Los condicionales quedan fuera: faltan en cada envío de quien no ve esa
    // pregunta, y esa falsa alarma enseñaría a ignorar el aviso.
    const camposAusentes = Object.entries(TALLY_MAPPING)
      .filter(([k, regla]) => !(k in mapeados) && regla.conditional !== true)
      .map(([k]) => k);

    const parsed = validateAssessment(mapeados);

    if (!parsed.ok) {
      // Regla 9: el payload ya está guardado. Lo que falta es que alguien se
      // entere. El aviso lleva los NOMBRES de los campos, nunca sus valores.
      const fields = parsed.errors.map((e) => e.field);
      await deps.sender.sendMessage(
        trainer.chatId,
        // Nombres como `_root` llevan un guion bajo — especial en MarkdownV2
        // igual que un punto suelto, así que se escapa la lista entera.
        `Llegó una evaluación que no se pudo leer\\. Campos con problema: ${escapeMarkdownV2(fields.join(', '))}\\.`,
      );
      await deps.repo.markProcessed(eventId);
      return { kind: 'invalid', eventId, fields };
    }

    // ── 6. Las cuatro filas, en una sola operación ───────────────────────
    // El token se guarda EN UNA VARIABLE porque ahora también hay que
    // enseñárselo al entrenador. Antes se generaba dentro de la llamada y
    // nadie volvía a verlo: ese era exactamente el hueco (SPEC-014 §2).
    const linkToken = deps.newLinkToken();

    const ids = await deps.repo.ingestAssessment({
      trainerId: trainer.profileId,
      linkToken,
      rawPayload,
      ...parsed.value,
    });

    // El entrenador se entera. Hasta aquí el sistema creaba las cuatro filas
    // correctamente y nadie se enteraba salvo mirando la base de datos.
    //
    // El aviso dice QUE hay limitaciones, no cuáles: un mensaje de Telegram se
    // ve en la pantalla de bloqueo, y el detalle se lee al abrir la rutina.
    const aviso = buildAssessmentArrived(
      { ...parsed.value, clientName: parsed.value.fullName },
      ids.versionId,
      buildDeepLink(deps.botUsername, linkToken),
    );
    await deps.sender.sendMessage(trainer.chatId, aviso.text, aviso.keyboard);

    await deps.repo.markProcessed(eventId);

    // `ingested` NO lleva el token: el handler loguea `{ ...outcome }` y una
    // credencial en un log es un incidente (SPEC-014 regla 1).
    return { kind: 'ingested', eventId, ...ids, camposAusentes };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    };
  }
}
