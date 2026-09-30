/**
 * SPEC-031 — qué mostrar cuando se toca un botón de navegación.
 *
 * ┌─ DE SOLO LECTURA, A DIFERENCIA DE `actions.ts` ────────────────────────┐
 * │ Nunca llama a `transition`, nunca consulta `nextState`: navegar no es  │
 * │ un evento de la máquina de estados (regla 6 de SPEC-031). Si algún día │
 * │ esta función necesita escribir algo, ya no es este módulo.             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Comparte `ActionRepo` con `actions.ts`: mismo `versionId`, misma
 * necesidad de saber a quién pertenece la versión. La autorización usa
 * `canViewVersion` (leer), no `canModifyVersion` (escribir) — el cliente
 * navega su propia rutina en SENT, el entrenador la suya en cualquier estado.
 */
import { canViewVersion } from '../authorization.ts';
import type { Identity } from '../domain/identity.ts';
import type { Workout } from '../domain/workout.ts';
import type { ActionRepo } from '../ports/action-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import type { RoutineView } from './callback-data.ts';
import { formatForClient, formatIndexForClient, type ClientContext } from './client-format.ts';
import {
  formatDayView,
  formatIndexForTrainer,
  formatWorkout,
  sendLongMessage,
  type FormatContext,
} from './format.ts';
import { actionsForState, buildNavKeyboard, CLIENT_ACTIONS } from './keyboard.ts';

export interface NavRequest {
  readonly view: RoutineView;
  readonly versionId: string;
  readonly callbackQueryId: string;
}

export type NavOutcome =
  /** No es su versión, o no existe. Mismo trato que `actions.ts` (regla 12). */
  | { readonly kind: 'unauthorized' }
  /** Existe y es suya, pero todavía no tiene contenido (p. ej. NEW). */
  | { readonly kind: 'no_content' }
  | { readonly kind: 'shown'; readonly view: RoutineView };

export interface NavDeps {
  readonly repo: ActionRepo;
  readonly sender: TelegramSender;
}

/** Lo mismo para una versión ajena que para una que no existe (§ arriba). */
const RESPUESTA_NEUTRA = 'No puedo mostrarte eso\\.';

const SIN_CONTENIDO = 'Esta rutina todavía no tiene contenido\\.';

export async function handleNavigation(
  request: NavRequest,
  actor: Identity,
  deps: NavDeps,
): Promise<NavOutcome> {
  // El botón, antes que nada — mismo motivo que en `actions.ts`: Telegram lo
  // deja girando si se tarda, y quien lo tocó vuelve a pulsar.
  await deps.sender.answerCallback(request.callbackQueryId);

  const version = await deps.repo.findVersion(request.versionId);

  if (version === null || !canViewVersion(actor, version).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'unauthorized' };
  }

  if (version.content === null) {
    await deps.sender.sendMessage(actor.telegramChatId, SIN_CONTENIDO);
    return { kind: 'no_content' };
  }

  const content = version.content;

  // Regla 13 — un día que no existe (callback fabricado a mano, o una rutina
  // que se editó y perdió días desde que se armó el teclado) cae al índice,
  // sin error visible: no hay nada sensible que proteger en qué día se pidió.
  const vistaPedida = request.view;
  const vista: RoutineView =
    vistaPedida.kind === 'day' && !content.days.some((day) => day.dayNumber === vistaPedida.dayNumber)
      ? { kind: 'index' }
      : vistaPedida;

  const decisionActions = actor.role === 'client' ? CLIENT_ACTIONS : actionsForState(version.state);
  const totalDays = content.days.length;

  const texto =
    actor.role === 'client'
      ? formatearParaCliente(vista, content, { clientName: version.clientName, plan: version.plan })
      : formatearParaEntrenador(vista, content, {
          clientName: version.clientName,
          versionNumber: version.versionNumber,
        });

  // La vista completa puede no caber en un mensaje (SPEC-029 CA-6); índice y
  // un día nunca se acercan al límite. `sendLongMessage` sirve para los tres
  // y ya sabe poner el teclado solo en el último trozo.
  await sendLongMessage(
    deps.sender,
    actor.telegramChatId,
    texto,
    buildNavKeyboard({ view: vista, totalDays, versionId: version.versionId }, decisionActions),
  );

  return { kind: 'shown', view: vista };
}

/**
 * El `!`: `handleNavigation` ya comprobó que `vista.dayNumber` existe en
 * `content.days` antes de llegar aquí — si no existiera, `vista` habría
 * caído a `{ kind: 'index' }` y esta rama de `'day'` ni se alcanzaría. Un
 * `?? formatIndex...(...)` de más habría sido una rama que ningún test
 * puede ejercitar nunca: código defensivo de una situación imposible.
 */
function formatearParaEntrenador(vista: RoutineView, content: Workout, context: FormatContext): string {
  if (vista.kind === 'index') return formatIndexForTrainer(content, context);
  if (vista.kind === 'full') return formatWorkout(content, context);
  return formatDayView(content, vista.dayNumber)!;
}

function formatearParaCliente(vista: RoutineView, content: Workout, context: ClientContext): string {
  if (vista.kind === 'index') return formatIndexForClient(content, context);
  if (vista.kind === 'full') return formatForClient(content, context);
  return formatDayView(content, vista.dayNumber)!;
}
