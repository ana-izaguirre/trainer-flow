/**
 * SPEC-008 — Los comandos del editor, sobre el borrador en curso.
 *
 * ┌─ QUÉ BORRADOR, SI EL COMANDO NO LO DICE ───────────────────────────────┐
 * │ `/add 1 Press 4x8` no dice de quién. Se aplica al que el entrenador    │
 * │ tocó más recientemente.                                                │
 * │                                                                        │
 * │ No «el único abierto»: con dos clientes a la vez esa regla bloquearía  │
 * │ los dos. Y no un argumento de cliente: escribirlo en cada comando,     │
 * │ desde el móvil, es la fricción que hace que el camino manual no se use.│
 * │                                                                        │
 * │ A cambio, CADA respuesta dice sobre quién se aplicó.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AQUÍ NO CORRE `validateDraft` COMPLETO, Y ES DELIBERADO ──────────────┐
 * │ Un borrador a medias no puede pasarlo: `/dia 1 Empuje` deja un día sin │
 * │ ejercicios. Validando en cada edición, el primer comando siempre       │
 * │ fallaría y no habría forma de construir una rutina paso a paso.        │
 * │                                                                        │
 * │ Los rangos sí se comprueban —eso lo hace `applyEditorCommand`— y la    │
 * │ puerta completa está en APROBAR (regla 11).                            │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { parseWorkoutText } from '../editor/bulk.ts';
import {
  applyEditorCommand,
  parseEditorCommand,
  type ParseResult as ParsedCommand,
} from '../editor/commands.ts';
import type { CreationRepo } from '../ports/creation-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2, formatWorkout, sendLongMessage } from '../telegram/format.ts';

export interface EditorDeps {
  readonly repo: CreationRepo;
  readonly sender: TelegramSender;
}

export type EditorOutcome =
  | { readonly kind: 'not_an_editor_command' }
  | { readonly kind: 'no_draft' }
  | { readonly kind: 'shown'; readonly versionId: string }
  | { readonly kind: 'edited'; readonly versionId: string }
  /** El comando no se entendió, o sus valores no valen. */
  | { readonly kind: 'invalid'; readonly error: string }
  /** Se aprobó mientras escribía: la edición no se aplica. */
  | { readonly kind: 'not_draft_anymore' };

/**
 * SPEC-022 M2. Antes mandaba a «el aviso de un cliente», que ya estaba
 * enterrado en el chat. `/cliente <nombre>` lleva los mismos botones
 * (SPEC-007 regla 7): se nombra un camino que existe.
 */
const SIN_BORRADOR = [
  'No tienes ningún borrador abierto\\.',
  'Escribe /cliente y el nombre \\(por ejemplo /cliente Ana\\), pulsa',
  '📋 Plantilla o ✍️ A mano en su ficha, y después vuelve a /crear\\_rutina\\.',
].join('\n');

/**
 * SPEC-022 M1. El ejemplo va en un bloque de código: en Telegram se copia
 * entero con un toque, y el /crear_rutina de dentro no se vuelve un enlace
 * que, al pulsarlo, repita el error. El de la primera línea va como código en
 * línea por lo mismo. Dentro de un bloque MarkdownV2 no se escapa nada más
 * que ` y \\, y el ejemplo no lleva ninguno.
 */
const COMO_DICTAR = [
  'Escribe los días en el MISMO mensaje, debajo de `/crear_rutina`\\.',
  'Copia este ejemplo, cámbialo y envíalo:',
  '',
  '```',
  '/crear_rutina',
  'Día 1: Cuerpo completo A',
  'Sentadilla 3x10 120',
  'Press banca 3x10 90',
  '',
  'Día 2: Cuerpo completo B',
  'Peso muerto rumano 3x10 120',
  'Jalón al pecho 3x12 90',
  '```',
].join('\n');

/** Los comandos que este módulo atiende. El resto no son suyos. */
// `/rutina` NO está aquí a propósito: es del CLIENTE, que es quien lo
// escribe para ver la suya (SPEC-023). El del entrenador dicta una nueva.
const COMANDOS = ['crear_rutina', 'dia', 'día', 'add', 'quitar', 'nota', 'ver'] as const;

export function isEditorCommand(command: string): boolean {
  return (COMANDOS as readonly string[]).includes(command);
}

export async function handleEditorCommand(
  command: string,
  args: string,
  trainerId: string,
  chatId: number,
  deps: EditorDeps,
): Promise<EditorOutcome> {
  if (!isEditorCommand(command)) return { kind: 'not_an_editor_command' };

  const draft = await deps.repo.currentDraft(trainerId);
  if (draft === null) {
    await deps.sender.sendMessage(chatId, SIN_BORRADOR);
    return { kind: 'no_draft' };
  }

  // SPEC-022 M1. En el menú de comandos de Telegram, tocar /crear_rutina lo
  // ENVÍA al instante, sin nada debajo. Es el caso más común de «no hay
  // días», así que se contesta con el ejemplo entero para copiar.
  if (command === 'crear_rutina' && args.trim().length === 0) {
    await deps.sender.sendMessage(chatId, COMO_DICTAR);
    return { kind: 'invalid', error: 'crear_rutina sin días' };
  }

  const contexto = { clientName: draft.clientName, versionNumber: draft.versionNumber };

  if (command === 'ver') {
    await sendLongMessage(deps.sender, chatId, formatWorkout(draft.content, contexto));
    return { kind: 'shown', versionId: draft.versionId };
  }

  // `/crear_rutina` no es un comando con argumentos sueltos: es la rutina
  // entera en los renglones de abajo, con su propio parser (SPEC-022).
  const parsed =
    command === 'crear_rutina' ? parseBulk(args) : parseEditorSyntax(command, args);
  if (!parsed.ok) {
    await deps.sender.sendMessage(chatId, escapeMarkdownV2(parsed.error));
    return { kind: 'invalid', error: parsed.error };
  }

  const aplicado = applyEditorCommand(draft.content, parsed.command);
  if (!aplicado.ok) {
    await deps.sender.sendMessage(chatId, escapeMarkdownV2(aplicado.error));
    return { kind: 'invalid', error: aplicado.error };
  }

  if (!(await deps.repo.saveDraft(draft.versionId, aplicado.workout))) {
    // Se aprobó mientras escribía. Su cambio NO se pierde en silencio.
    await deps.sender.sendMessage(
      chatId,
      'Esa rutina ya no es un borrador\\. Tu cambio no se aplicó\\.',
    );
    return { kind: 'not_draft_anymore' };
  }

  // ┌─ SE DEVUELVE LA RUTINA ENTERA, NO UN «actualizada» ──────────────────┐
  // │ Antes había que pedir `/ver` para saber si el comando hizo lo que se │
  // │ esperaba. Editar a ciegas y comprobar después es la mitad de por qué │
  // │ el modo manual «no se entendía».                                     │
  // │                                                                       │
  // │ Y `formatWorkout` lleva el nombre del cliente en la cabecera, así que │
  // │ sigue diciendo de QUIÉN es: el hueco del contexto implícito no se     │
  // │ reabre.                                                               │
  // └───────────────────────────────────────────────────────────────────────┘
  await sendLongMessage(deps.sender, chatId, formatWorkout(aplicado.workout, contexto));

  return { kind: 'edited', versionId: draft.versionId };
}

/** `/crear_rutina` — la rutina dictada de corrido. */
function parseBulk(args: string): ParsedCommand {
  const leido = parseWorkoutText(args);
  return leido.ok
    ? { ok: true, command: { kind: 'setDays', days: leido.days } }
    : { ok: false, error: leido.error };
}

/** El resto de comandos, con su sintaxis de siempre. */
function parseEditorSyntax(command: string, args: string): ParsedCommand {
  // `día` con tilde se acepta al escribirlo, pero el parser conoce `dia`.
  return parseEditorCommand(command === 'día' ? 'dia' : command, args);
}
