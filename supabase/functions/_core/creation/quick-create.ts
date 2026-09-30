/**
 * SPEC-031 — `/crear_rutina <cliente>`, la ficha y la dictada en un mensaje.
 *
 * ┌─ POR QUÉ ESTO NO VIVE EN `editor-session.ts` ──────────────────────────┐
 * │ El editor entero (`/dia`, `/add`, `/quitar`, `/nota`, `/ver`, y         │
 * │ `/crear_rutina` sin nombre) actúa sobre `currentDraft`: el borrador que │
 * │ el entrenador tocó más recientemente, sin ningún cliente en el         │
 * │ comando. Este módulo es la EXCEPCIÓN: solo `/crear_rutina` puede       │
 * │ llevar a quién, y solo cuando la primera línea nombra a alguien.       │
 * │                                                                        │
 * │ Separarlo deja `editor-session.ts` intacto — nada de lo que ya         │
 * │ funciona cambia — y aquí vive TODO lo nuevo: los 6 estados posibles de │
 * │ la versión vigente, la revisión automática, la ambigüedad sin botones. │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';
import { isDayHeader, parseWorkoutText } from '../editor/bulk.ts';
import { withDays } from '../editor/commands.ts';
import { matchClientName } from '../commands/match.ts';
import { formatQuickCreateAmbiguous } from '../commands/format.ts';
import type { ChangeRequestRepo } from '../ports/change-request-ports.ts';
import type { QueryRepo } from '../ports/query-ports.ts';
import type { CreationRepo } from '../ports/creation-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2, formatWorkout, sendLongMessage } from '../telegram/format.ts';
import { SIGUIENTE_PASO, VACIA } from './flows.ts';

export interface QuickCreateDeps {
  readonly clients: Pick<QueryRepo, 'clients' | 'clientDetail'>;
  readonly creation: CreationRepo;
  readonly changes: Pick<ChangeRequestRepo, 'findVersion' | 'createRevision'>;
  readonly sender: TelegramSender;
}

export type QuickCreateOutcome =
  /** La primera línea no es un intento de nombrar a alguien: sigue el flujo de siempre. */
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'filled'; readonly versionId: string }
  | { readonly kind: 'revised'; readonly versionId: string }
  | { readonly kind: 'named_only' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'rejected'; readonly reason: string };

/**
 * SPEC-031 §3.2 — el patrón: primera línea que no es cabecera de día, que
 * coincide con exactamente un cliente, y algo más debajo.
 *
 * Se llama ANTES de `handleEditorCommand`. `not_applicable` es la señal de
 * «esto no es mío»: quien llama sigue con el camino de siempre.
 */
export async function handleQuickCreate(
  args: string,
  trainerId: string,
  chatId: number,
  deps: QuickCreateDeps,
): Promise<QuickCreateOutcome> {
  if (args.trim().length === 0) return { kind: 'not_applicable' };

  const salto = args.indexOf('\n');
  const primeraLinea = (salto === -1 ? args : args.slice(0, salto)).trim();
  const resto = salto === -1 ? '' : args.slice(salto + 1);

  // Regla 1: una cabecera de día nunca es un nombre, aunque el foco escrito
  // coincida por casualidad con uno.
  if (isDayHeader(primeraLinea) || primeraLinea.length === 0) {
    return { kind: 'not_applicable' };
  }

  const clientes = await deps.clients.clients(trainerId);
  const encontrado = matchClientName(clientes, primeraLinea);

  // Regla 3: sin match, el mensaje ENTERO (con la línea de nombre incluida)
  // sigue el camino de siempre. `parseWorkoutText` ya rechaza con su propio
  // error una línea que no es día ni ejercicio — no hace falta adivinar.
  if (encontrado.kind === 'none') return { kind: 'not_applicable' };

  if (encontrado.kind === 'many') {
    await deps.sender.sendMessage(chatId, formatQuickCreateAmbiguous(encontrado.clients));
    return { kind: 'ambiguous' };
  }

  const cliente = encontrado.client;

  // Regla 4: nombre encontrado, nada debajo. No se toca nada.
  if (resto.trim().length === 0) {
    await deps.sender.sendMessage(chatId, comoDictarPara(cliente.fullName));
    return { kind: 'named_only' };
  }

  const dictado = parseWorkoutText(resto);
  if (!dictado.ok) {
    await deps.sender.sendMessage(chatId, escapeMarkdownV2(dictado.error));
    return { kind: 'rejected', reason: dictado.error };
  }

  const detalle = await deps.clients.clientDetail(cliente.clientId);
  if (detalle === null || detalle.versionId === null || detalle.versionState === null) {
    await deps.sender.sendMessage(chatId, sinEvaluacionTodavia(cliente.fullName));
    return { kind: 'rejected', reason: 'sin versión' };
  }

  const contenido = withDays(VACIA, dictado.days);

  return aplicarSegunEstado(
    detalle.versionId,
    detalle.versionState,
    detalle.fullName,
    contenido,
    trainerId,
    chatId,
    deps,
  );
}

async function aplicarSegunEstado(
  versionId: string,
  estado: VersionState,
  clientName: string,
  contenido: Workout,
  trainerId: string,
  chatId: number,
  deps: QuickCreateDeps,
): Promise<QuickCreateOutcome> {
  switch (estado) {
    case 'NEW': {
      const ok = await deps.creation.fillVersion(versionId, 'NEW', 'manual', null, contenido);
      if (!ok) return rechazoDeCarrera(chatId, deps);
      await confirmarYEnviar(versionId, contenido, chatId, deps);
      return { kind: 'filled', versionId };
    }

    case 'DRAFT': {
      const ok = await deps.creation.saveDraft(versionId, contenido);
      if (!ok) return rechazoDeCarrera(chatId, deps);
      await confirmarYEnviar(versionId, contenido, chatId, deps);
      return { kind: 'filled', versionId };
    }

    case 'GENERATING':
    case 'APPROVED':
      await deps.sender.sendMessage(chatId, escapeMarkdownV2(SIGUIENTE_PASO[estado]));
      return { kind: 'rejected', reason: `estado ${estado}` };

    case 'SENT':
    case 'REJECTED': {
      const version = await deps.changes.findVersion(versionId);
      if (version === null) return rechazoDeCarrera(chatId, deps);

      const nueva = await deps.changes.createRevision(version.planId, trainerId);
      const ok = await deps.creation.fillVersion(nueva, 'NEW', 'manual', null, contenido);
      if (!ok) return rechazoDeCarrera(chatId, deps);

      await deps.sender.sendMessage(
        chatId,
        `✏️ Creé una versión nueva para ${escapeMarkdownV2(clientName)} — la anterior sigue como estaba\\.`,
      );
      await confirmarYEnviar(nueva, contenido, chatId, deps);
      return { kind: 'revised', versionId: nueva };
    }
  }
}

/**
 * Relee SOLO el nombre y el número de versión — el contenido ya se tiene en
 * memoria, es el mismo que se acaba de escribir. Releerlo de la base traería
 * el riesgo de traer el de OTRO borrador si algo más lo tocó entre medias.
 */
async function confirmarYEnviar(
  versionId: string,
  contenido: Workout,
  chatId: number,
  deps: QuickCreateDeps,
): Promise<void> {
  const version = await deps.creation.findVersion(versionId);
  if (version === null) return; // Se aprobó/borró en el instante entre medias; nada que mostrar.

  await sendLongMessage(
    deps.sender,
    chatId,
    formatWorkout(contenido, {
      clientName: version.clientName,
      versionNumber: version.versionNumber,
    }),
  );
}

async function rechazoDeCarrera(chatId: number, deps: QuickCreateDeps): Promise<QuickCreateOutcome> {
  await deps.sender.sendMessage(chatId, 'Esa rutina ya no es un borrador\\. Tu cambio no se aplicó\\.');
  return { kind: 'rejected', reason: 'carrera' };
}

function comoDictarPara(clientName: string): string {
  return [
    `Encontré a ${escapeMarkdownV2(clientName)}\\. Escribe los días DEBAJO, en el mismo mensaje:`,
    '',
    '```',
    'Día 1: Empuje',
    'Press banca 4x8 90',
    '```',
  ].join('\n');
}

function sinEvaluacionTodavia(clientName: string): string {
  return `${escapeMarkdownV2(clientName)} todavía no tiene evaluación\\. Cuando la complete, puedes crear su rutina\\.`;
}
