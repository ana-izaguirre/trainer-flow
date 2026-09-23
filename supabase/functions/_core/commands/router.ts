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
import { buildKeyboard, CLIENT_ACTIONS } from '../telegram/keyboard.ts';
import type { QueryRepo } from '../ports/query-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import {
  AYUDA,
  formatAmbiguous,
  formatClientDetail,
  formatClientList,
  formatNotFound,
  formatPending,
  formatStaleCheckins,
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

    await deps.sender.sendMessage(
      actor.telegramChatId,
      formatForClient(rutina.content, { clientName: rutina.clientName, plan: rutina.plan }),
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
    await deps.sender.sendMessage(actor.telegramChatId, formatAmbiguous(encontrado.clients));
    return { kind: 'answered', command: 'cliente', messages: 1 };
  }

  if (encontrado.kind === 'none') {
    await deps.sender.sendMessage(actor.telegramChatId, formatNotFound(encontrado.suggestions));
    return { kind: 'answered', command: 'cliente', messages: 1 };
  }

  // `clients()` ya venía filtrado por `trainer_id`, así que el id con el que
  // se pide el detalle es de los suyos por construcción: no puede pedirse uno
  // ajeno, porque no hay dónde escribirlo (SPEC-009 regla 8).
  const detalle = await deps.repo.clientDetail(encontrado.client.clientId);

  await deps.sender.sendMessage(
    actor.telegramChatId,
    detalle === null ? formatNotFound([]) : formatClientDetail(detalle),
  );

  return { kind: 'answered', command: 'cliente', messages: 1 };
}

async function pendientes(actor: Identity, deps: CommandDeps): Promise<CommandOutcome> {
  const versiones = await deps.repo.pendingVersions(actor.profileId);

  // Una por mensaje: el `callback_data` de un botón lleva UN `versionId`.
  const mensajes = formatPending(versiones);
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
