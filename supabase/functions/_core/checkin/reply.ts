/**
 * SPEC-006 — Lo que pasa cuando el cliente contesta.
 *
 * ┌─ EL `checkinId` DEL BOTÓN NO AUTORIZA NADA ────────────────────────────┐
 * │ Viaja en el `callback_data`, que cualquiera puede fabricar. Lo que     │
 * │ impide contestar el check-in de otro es la comparación de abajo,       │
 * │ contra la identidad que resolvió el webhook (CA-7).                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LA MOLESTIA SE AVISA EN EL MOMENTO ───────────────────────────────────┐
 * │ No al completar el check-in, no al final de la semana: al recibirla.   │
 * │ Un dolor que aparece el martes y se avisa el domingo es una lesión     │
 * │ que se pudo evitar (regla 7).                                          │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Identity } from '../domain/identity.ts';
import type { CheckinRepo } from '../ports/checkin-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { isComplete, mergeAnswer, needsTrainerAlert, type CheckinAnswer } from './answers.ts';
import { formatCheckinAck, formatTrainerAlert, GRACIAS } from './format.ts';

export interface ReplyDeps {
  readonly repo: CheckinRepo;
  readonly sender: TelegramSender;
}

export type ReplyOutcome =
  /** Ajeno, inexistente o ya cerrado. Los tres responden igual. */
  | { readonly kind: 'rejected' }
  | { readonly kind: 'no_open_checkin' }
  | {
      readonly kind: 'saved';
      readonly checkinId: string;
      readonly completed: boolean;
      readonly trainerAlerted: boolean;
      /**
       * SPEC-030 regla 9: el texto del acuse de `answerCallbackQuery`.
       * `null` cuando vino de un mensaje de texto (la molestia escrita), que
       * no tiene callback al que responder.
       */
      readonly ack: string | null;
    };

/**
 * Lo que devuelve específicamente `handleCheckinAnswer`: un botón SIEMPRE
 * tiene algo que decir (regla 9), así que aquí `ack` no es opcional. Sin este
 * tipo aparte, quien llama tendría que comprobar un `null` que nunca llega —
 * una rama que ningún test podría alcanzar, en un módulo con 100% obligatorio.
 */
export type ButtonReplyOutcome =
  | { readonly kind: 'rejected' }
  | {
      readonly kind: 'saved';
      readonly checkinId: string;
      readonly completed: boolean;
      readonly trainerAlerted: boolean;
      readonly ack: string;
    };

/**
 * Lo mismo para un check-in ajeno que para uno que no existe.
 *
 * Si se distinguieran, probar identificadores diría cuáles existen.
 */
const RESPUESTA_NEUTRA = 'No puedo anotar eso\\.';

/** Una respuesta de botón: `chk:<campo>:<valor>:<checkinId>`. */
export async function handleCheckinAnswer(
  checkinId: string,
  answer: CheckinAnswer,
  actor: Identity,
  deps: ReplyDeps,
): Promise<ButtonReplyOutcome> {
  const checkin = await deps.repo.findCheckin(checkinId);

  // No existe, no es suyo, o ya lo cerró. La misma respuesta para los tres.
  if (
    checkin === null ||
    checkin.clientProfileId !== actor.profileId ||
    checkin.state !== 'PENDING'
  ) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'rejected' };
  }

  const answers = mergeAnswer(checkin.answers, answer);
  const guardado = await guardar(checkin.checkinId, answers, checkin, actor, deps);
  // Regla 9: el acuse nombra lo que se acaba de guardar y, si falta algo, qué.
  return { kind: 'saved', ...guardado, ack: formatCheckinAck(answer, answers) };
}

/**
 * Un mensaje suelto del cliente.
 *
 * Solo se lee como molestia si hay un check-in esperándola. Si no, no es una
 * respuesta: es alguien escribiéndole al bot, y eso no se inventa.
 *
 * `askedBefore` es la fecha de OTRA pregunta pendiente —hoy, el comentario de
 * una solicitud de cambio (SPEC-010 §3)—. Si esa es más reciente, el texto no
 * es para el check-in: uno contesta a la última pregunta que le hicieron.
 */
export async function handleCheckinText(
  text: string,
  actor: Identity,
  deps: ReplyDeps,
  askedBefore: Date | null = null,
): Promise<ReplyOutcome> {
  const checkin = await deps.repo.findOpenCheckin(actor.profileId);

  if (checkin === null || checkin.answers.discomfort !== null) {
    return { kind: 'no_open_checkin' };
  }

  if (askedBefore !== null && askedBefore.getTime() > checkin.sentAt.getTime()) {
    return { kind: 'no_open_checkin' };
  }

  const answers = mergeAnswer(checkin.answers, { field: 'discomfort', value: text });
  const guardado = await guardar(checkin.checkinId, answers, checkin, actor, deps);
  // `null`: un mensaje de texto no tiene callback al que responder.
  return { kind: 'saved', ...guardado, ack: null };
}

/** Lo que hay que guardar, confirmar y avisar. Compartido por los dos caminos. */
interface Guardado {
  readonly checkinId: string;
  readonly completed: boolean;
  readonly trainerAlerted: boolean;
}

async function guardar(
  checkinId: string,
  answers: ReturnType<typeof mergeAnswer>,
  checkin: { clientName: string; weekNumber: number; trainerChatId: number },
  actor: Identity,
  deps: ReplyDeps,
): Promise<Guardado> {
  const completed = isComplete(answers);
  await deps.repo.saveAnswers(checkinId, answers, completed);

  // Regla 7: el aviso no espera a que el check-in esté completo. Y sale antes
  // de dar las gracias: si el envío al entrenador falla, se ve en ese fallo y
  // no queda enterrado tras un «anotado».
  const trainerAlerted = needsTrainerAlert(answers);
  if (trainerAlerted) {
    await deps.sender.sendMessage(
      checkin.trainerChatId,
      formatTrainerAlert(checkin.clientName, checkin.weekNumber, answers),
    );
  }

  if (completed) {
    await deps.sender.sendMessage(actor.telegramChatId, GRACIAS);
  }

  return { checkinId, completed, trainerAlerted };
}
