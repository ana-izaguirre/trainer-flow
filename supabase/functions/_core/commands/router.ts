/**
 * SPEC-007 — Qué hace cada comando del entrenador.
 *
 * ┌─ LA REGLA 1 SE HACE CUMPLIR ANTES DE CONSULTAR ────────────────────────┐
 * │ Un cliente que escriba `/clientes` recibe una frase genérica, y NADA   │
 * │ toca la base de datos. No se consulta y luego se filtra: no se         │
 * │ consulta.                                                              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ESTE MÓDULO NO PUEDE ESCRIBIR ────────────────────────────────────────┐
 * │ `QueryRepo` no expone ninguna escritura. Un comando no puede aprobar   │
 * │ una rutina aunque el código lo intentara, porque no tiene con qué.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Identity } from '../domain/identity.ts';
import { formatForClient } from '../telegram/client-format.ts';
import { sendLongMessage } from '../telegram/format.ts';
import { buildKeyboard, CLIENT_ACTIONS } from '../telegram/keyboard.ts';
import type { ClientDetail, QueryRepo } from '../ports/query-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import {
  AYUDA,
  formatAmbiguous,
  formatClientDetail,
  formatClientList,
  formatNotFound,
  formatPending,
  formatStaleCheckins,
  keyboardForDetail,
  AYUDA_CLIENTE,
  PIDE_NOMBRE_CLIENTE,
  SIN_RUTINA_TODAVIA,
} from './format.ts';
import { matchClientName } from './match.ts';

/** Regla 3 de `/checkins`: dos días es cuando deja de ser «aún no contestó». */
const DIAS_PARA_RECLAMAR = 2;

export interface CommandDeps {
  readonly repo: QueryRepo;
  readonly sender: TelegramSender;
}

export type CommandOutcome =
  | { readonly kind: 'answered'; readonly command: string; readonly messages: number }
  /** Un cliente lo intentó. Se responde, no se consulta. */
  | { readonly kind: 'forbidden'; readonly command: string }
  | { readonly kind: 'unknown'; readonly command: string }
  /** No es un comando de esta spec: lo atiende otro (p. ej. `/start`). */
  | { readonly kind: 'not_mine' };

export async function handleCommand(
  command: string,
  args: string,
  actor: Identity,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  // `/start` lo atiende el canje del deep link, antes incluso de que haya
  // identidad. Un comando DESCONOCIDO sí es nuestro: la regla 6 dice que
  // responde `/ayuda`.
  if (command === 'start') return { kind: 'not_mine' };

  // ── Regla 1, antes de cualquier consulta ───────────────────────────────
  // El cliente no accede a NINGUNA consulta del entrenador. Pero tiene las
  // suyas, y hasta ahora chocaba con un muro incluso al pedir ayuda.
  if (actor.role !== 'trainer') return atenderCliente(command, actor, deps);

  switch (command) {
    case 'clientes':
      return listar(actor, deps);

    case 'cliente':
      return ficha(args, actor, deps);

    case 'pendientes':
      return pendientes(actor, deps);

    case 'checkins':
      return checkins(actor, deps);

    case 'ayuda':
    case 'help':
      await deps.sender.sendMessage(actor.telegramChatId, AYUDA);
      return { kind: 'answered', command, messages: 1 };

    default:
      // Regla 6. Y CA-8: ni una consulta.
      await deps.sender.sendMessage(actor.telegramChatId, AYUDA);
      return { kind: 'unknown', command };
  }
}

/**
 * Los comandos del CLIENTE (SPEC-023).
 *
 * `/rutina` es lo primero que escribe alguien que quiere ver la suya, así que
 * es SUYO. El comando con el que el entrenador dicta una se llama
 * `/crear_rutina` por eso mismo.
 *
 * Todo lo demás —incluido un comando del entrenador— responde con su ayuda:
 * no se lleva ningún dato, y sale sabiendo qué SÍ puede hacer.
 */
async function atenderCliente(
  command: string,
  actor: Identity,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  if (command === 'rutina') {
    // El puerto recibe su PERFIL, no un id de cliente: no existe la forma de
    // pedir la rutina de otro porque no hay dónde ponerla.
    const rutina = await deps.repo.clientRoutine(actor.profileId);

    if (rutina === null) {
      await deps.sender.sendMessage(actor.telegramChatId, SIN_RUTINA_TODAVIA);
      return { kind: 'answered', command, messages: 1 };
    }

    // SPEC-029 §6: la misma partición por bloques que en la entrega.
    await sendLongMessage(
      deps.sender,
      actor.telegramChatId,
      formatForClient(rutina.content, {
        clientName: rutina.clientName,
        plan: rutina.plan,
        versionNumber: rutina.versionNumber,
      }),
      // Los mismos botones que traía al entregarse: sin ellos, «pedir un
      // cambio» solo existiría en el mensaje original (SPEC-010 regla 10).
      buildKeyboard(CLIENT_ACTIONS, rutina.versionId),
    );
    return { kind: 'answered', command, messages: 1 };
  }

  await deps.sender.sendMessage(actor.telegramChatId, AYUDA_CLIENTE);

  // `answered` para los suyos, `forbidden` para los del entrenador: el
  // registro sigue distinguiéndolos aunque la respuesta sea la misma.
  return command === 'ayuda' || command === 'help'
    ? { kind: 'answered', command, messages: 1 }
    : { kind: 'forbidden', command };
}

async function listar(actor: Identity, deps: CommandDeps): Promise<CommandOutcome> {
  const clientes = await deps.repo.clients(actor.profileId);

  // Se parte aquí, donde se sabe cuántos hay, en vez de dejar que el corte
  // por caracteres decida (regla 4).
  const paginas = formatClientList(clientes);
  for (const pagina of paginas) {
    await deps.sender.sendMessage(actor.telegramChatId, pagina);
  }

  return { kind: 'answered', command: 'clientes', messages: paginas.length };
}

async function ficha(args: string, actor: Identity, deps: CommandDeps): Promise<CommandOutcome> {
  // Regla 2 (SPEC-007). Sin nombre no es «no encontrado»: es que no buscó
  // nada. Se responde ANTES de consultar — la misma disciplina de la regla 1,
  // aplicada a un caso que no es de autorización sino de entrada vacía.
  if (args.trim().length === 0) {
    await deps.sender.sendMessage(actor.telegramChatId, PIDE_NOMBRE_CLIENTE);
    return { kind: 'answered', command: 'cliente', messages: 1 };
  }

  const clientes = await deps.repo.clients(actor.profileId);
  const encontrado = matchClientName(clientes, args);

  if (encontrado.kind === 'many') {
    // SPEC-022 M4: cada nombre, un botón `cli:` que abre su ficha.
    const paginas = formatAmbiguous(encontrado.clients);
    for (const pagina of paginas) {
      await deps.sender.sendMessage(actor.telegramChatId, pagina.text, pagina.keyboard);
    }
    return { kind: 'answered', command: 'cliente', messages: paginas.length };
  }

  if (encontrado.kind === 'none') {
    await deps.sender.sendMessage(actor.telegramChatId, formatNotFound(encontrado.suggestions));
    return { kind: 'answered', command: 'cliente', messages: 1 };
  }

  // `clients()` ya venía filtrado por `trainer_id`, así que el id con el que
  // se pide el detalle es de los suyos por construcción: no puede pedirse uno
  // ajeno, porque no hay dónde escribirlo (SPEC-009 regla 8).
  const detalle = await deps.repo.clientDetail(encontrado.client.clientId);

  if (detalle === null) {
    await deps.sender.sendMessage(actor.telegramChatId, formatNotFound([]));
  } else {
    await enviarFicha(detalle, actor, deps);
  }

  return { kind: 'answered', command: 'cliente', messages: 1 };
}

/**
 * La respuesta a un `cli:` que no abre nada.
 *
 * **Una sola** para un id ajeno, uno inexistente, una ficha borrada entre
 * medias y un cliente que fabrica el botón (SPEC-013 regla 2): probar ids no
 * revela cuáles existen ni de quién son.
 */
export const FICHA_NO_DISPONIBLE = 'No encontré esa ficha\\. Búscala con /cliente y el nombre\\.';

/**
 * SPEC-022 M4 — El botón `cli:<clientId>` de una búsqueda con varios.
 *
 * ┌─ AQUÍ EL ID SÍ LLEGA DE FUERA ─────────────────────────────────────────┐
 * │ En `/cliente <nombre>` el id sale de `clients()`, así que es de los    │
 * │ suyos por construcción. Aquí viene en el `callback_data`, que         │
 * │ cualquiera puede fabricar. Por eso se comprueba contra SU cartera —la  │
 * │ misma consulta, filtrada por `trainer_id`— ANTES de pedir el detalle,  │
 * │ que no filtra por entrenador.                                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Solo lectura: la ficha que abre es la misma de `/cliente <nombre>`, y sus
 * botones llevan a acciones con su propia autorización.
 */
export async function showClient(
  clientId: string,
  actor: Identity,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  // Regla 1 (SPEC-007), antes de consultar: un cliente no mira fichas.
  const esSuyo =
    actor.role === 'trainer' &&
    (await deps.repo.clients(actor.profileId)).some((c) => c.clientId === clientId);

  const detalle = esSuyo ? await deps.repo.clientDetail(clientId) : null;

  if (detalle === null) {
    await deps.sender.sendMessage(actor.telegramChatId, FICHA_NO_DISPONIBLE);
    return { kind: 'forbidden', command: 'cliente' };
  }

  await enviarFicha(detalle, actor, deps);
  return { kind: 'answered', command: 'cliente', messages: 1 };
}

/**
 * Regla 7 (SPEC-007): la ficha lleva botones según el estado de su rutina
 * vigente. Antes de esto, `/cliente <nombre>` nunca tenía ninguno: si la
 * tarjeta original se perdía en el chat, no quedaba ningún camino de vuelta
 * (ver docs/STATE-MACHINE.md).
 */
function enviarFicha(detalle: ClientDetail, actor: Identity, deps: CommandDeps): Promise<void> {
  return deps.sender.sendMessage(
    actor.telegramChatId,
    formatClientDetail(detalle),
    keyboardForDetail(detalle),
  );
}

async function pendientes(actor: Identity, deps: CommandDeps): Promise<CommandOutcome> {
  // SPEC-030 regla 14: las dos listas, en paralelo.
  const [versiones, esperandoEnlace] = await Promise.all([
    deps.repo.pendingVersions(actor.profileId),
    deps.repo.awaitingLink(actor.profileId),
  ]);

  // Una por mensaje: el `callback_data` de un botón lleva UN `versionId`.
  const mensajes = formatPending(versiones, esperandoEnlace);
  for (const mensaje of mensajes) {
    await deps.sender.sendMessage(actor.telegramChatId, mensaje.text, mensaje.keyboard);
  }

  return { kind: 'answered', command: 'pendientes', messages: mensajes.length };
}

async function checkins(actor: Identity, deps: CommandDeps): Promise<CommandOutcome> {
  const sinResponder = await deps.repo.staleCheckins(actor.profileId, DIAS_PARA_RECLAMAR);

  await deps.sender.sendMessage(actor.telegramChatId, formatStaleCheckins(sinResponder));

  return { kind: 'answered', command: 'checkins', messages: 1 };
}
