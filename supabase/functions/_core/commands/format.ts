/**
 * SPEC-007 §3 — Los mensajes de los comandos.
 *
 * ┌─ UNA LISTA SE PARTE, NO SE TRUNCA ─────────────────────────────────────┐
 * │ Con 25 clientes salen dos mensajes con los 25, no uno con 20 y el      │
 * │ resto perdido (regla 4). Una lista que se corta en silencio es peor    │
 * │ que un error: el entrenador cree que ya los vio todos.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type {
  ClientDetail,
  ClientSummary,
  PendingVersion,
  StaleCheckin,
} from '../ports/query-ports.ts';
import { REASON_LABELS } from '../domain/change-request.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildClientCallback } from '../telegram/client-callback.ts';
import {
  actionsForState,
  buildKeyboard,
  DRAFT_ACTIONS,
  type InlineKeyboard,
} from '../telegram/keyboard.ts';

/** Regla 4. Veinte líneas caben en una pantalla sin hacer scroll eterno. */
export const PAGE_SIZE = 20;

/** Trozos de `PAGE_SIZE`. Una lista vacía da cero páginas. */
function paginate<T>(items: readonly T[]): T[][] {
  const paginas: T[][] = [];
  for (let i = 0; i < items.length; i += PAGE_SIZE) paginas.push(items.slice(i, i + PAGE_SIZE));
  return paginas;
}

export interface CommandMessage {
  readonly text: string;
  readonly keyboard?: InlineKeyboard | null;
}

/** El nivel, en palabras que el entrenador reconoce. */
const NIVEL: Readonly<Record<string, string>> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};

const SENSACION: Readonly<Record<string, string>> = {
  hard: '😫 Muy duro',
  good: '💪 Bien',
  easy: '😌 Fácil',
};

/** Qué le pasa a este cliente, en un vistazo. Lo urgente primero. */
function estadoDeCliente(c: ClientSummary): string {
  if (!c.linked) return '🔗 sin vincular al bot';
  if (c.pendingCheckinDays !== null && c.pendingCheckinDays >= 2) {
    return `⚠️ check\\-in sin responder \\(${c.pendingCheckinDays} días\\)`;
  }
  if (c.versionState === null) return '📭 sin rutina todavía';
  if (c.versionState === 'DRAFT') return '⏳ rutina pendiente de revisión';
  if (c.versionState === 'GENERATING') return '⚙️ generándose';
  if (c.versionState === 'NEW') return '📭 sin rutina todavía';
  if (c.versionState === 'REJECTED') return '❌ última rechazada';
  return 'rutina activa · check\\-in al día';
}

/**
 * `/clientes`, partido en mensajes de 20.
 *
 * Devuelve varios porque partirlo aquí —donde se sabe cuántos hay— es más
 * honesto que dejar que `splitMessage` corte por caracteres a ciegas.
 */
export function formatClientList(clients: readonly ClientSummary[]): string[] {
  if (clients.length === 0) {
    return [
      '👥 Todavía no tienes clientes\\.\n\n' +
        'En cuanto alguien rellene el formulario de Tally aparecerá aquí, ' +
        'y te aviso en el momento\\.',
    ];
  }

  const paginas: string[] = [];

  for (let i = 0; i < clients.length; i += PAGE_SIZE) {
    const trozo = clients.slice(i, i + PAGE_SIZE);
    const cabecera =
      clients.length <= PAGE_SIZE
        ? `👥 *Tus clientes* \\(${clients.length}\\)`
        : `👥 *Tus clientes* \\(${i + 1}–${i + trozo.length} de ${clients.length}\\)`;

    paginas.push(
      [cabecera, '', ...trozo.map((c) => `• ${escapeMarkdownV2(c.fullName)} — ${estadoDeCliente(c)}`)].join('\n'),
    );
  }

  return paginas;
}

/** `/cliente <nombre>` — la ficha. */
export function formatClientDetail(c: ClientDetail): string {
  const lineas = [`👤 *${escapeMarkdownV2(c.fullName)}*`];

  if (c.goal !== null) {
    const nivel = c.level === null ? '' : ` · ${NIVEL[c.level] ?? c.level}`;
    lineas.push(escapeMarkdownV2(`Objetivo: ${c.goal}${nivel}`));
  }

  if (c.daysPerWeek !== null) {
    lineas.push(
      escapeMarkdownV2(`${c.daysPerWeek} días · ${c.sessionMinutes} min · ${c.equipment ?? '—'}`),
    );
  }

  // Que HAY limitación, no cuál: el detalle vive en la rutina, que es donde
  // el entrenador lo necesita al revisarla.
  if (c.hasLimitations) lineas.push('⚠️ Declaró limitaciones');

  lineas.push('');

  if (c.versionState === null || c.versionNumber === null) {
    lineas.push('📋 Sin rutina todavía');
  } else if (c.versionState === 'SENT' && c.sentDaysAgo !== null) {
    lineas.push(
      `📋 Rutina v${c.versionNumber} — enviada hace ${c.sentDaysAgo} ${c.sentDaysAgo === 1 ? 'día' : 'días'}`,
    );
  } else {
    lineas.push(`📋 Rutina v${c.versionNumber} — ${escapeMarkdownV2(c.versionState)}`);
  }

  if (!c.linked) lineas.push('🔗 Aún no ha abierto su enlace');

  // SPEC-030 regla 11: solo motivo y fecha. El comentario puede llevar datos
  // de salud, y la ficha se lee de un vistazo — está completo en el aviso.
  if (c.openChangeRequest !== null) {
    const { reason, daysAgo } = c.openChangeRequest;
    const cuando = daysAgo === 0 ? 'hoy' : `hace ${daysAgo} ${daysAgo === 1 ? 'día' : 'días'}`;
    lineas.push(`🔔 Pidió un cambio ${cuando}: ${REASON_LABELS[reason]}`);
  }

  if (c.lastCheckin !== null) {
    const k = c.lastCheckin;
    const sesiones = k.sessions === null ? 'sin contestar' : String(k.sessions);
    const sensacion = k.feeling === null ? 'sin contestar' : (SENSACION[k.feeling] ?? k.feeling);
    lineas.push(
      `📊 Último check\\-in: semana ${k.weekNumber} — ${escapeMarkdownV2(sesiones)} · ${sensacion}`,
    );

    if (k.discomfort !== null && k.discomfort.trim().length > 0) {
      lineas.push(`   ⚠️ ${escapeMarkdownV2(k.discomfort)}`);
    }
  }

  return lineas.join('\n');
}

/**
 * Los botones de la ficha — SPEC-007 regla 7.
 *
 * ┌─ POR QUÉ NUNCA OFRECE 'edit' ──────────────────────────────────────────┐
 * │ Ese botón ya existe en `/pendientes` desde SPEC-004 y hoy no hace       │
 * │ nada: cae en «Eso todavía no está listo», porque el flujo conversa-     │
 * │ cional de edición sigue sin construirse (SPEC-004 sigue PARCIAL).       │
 * │ Repetirlo aquí sería fabricar un segundo botón muerto en vez de         │
 * │ arreglar el primero. Para editar un DRAFT, el camino real es `/ver`.    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUÉ 'revise' SOLO EN SENT Y REJECTED, NUNCA EN APPROVED ──────────┐
 * │ `startRevision` no mira el estado de la versión: mueve                  │
 * │ `current_version_id` a la v2 sin condición (SPEC-010). Desde SENT o     │
 * │ REJECTED eso es exactamente lo que ya hace en producción el flujo de    │
 * │ «pedir un cambio». Desde APPROVED sería un camino nuevo y nunca         │
 * │ ejercitado: la v1 sigue esperando que el cliente se vincule para        │
 * │ recibirla, y la v2 vacía se volvería la vigente antes de que la v1 le   │
 * │ llegara a nadie. No se ofrece hasta que alguien lo decida con su propia │
 * │ spec (ver docs/STATE-MACHINE.md, «Cobertura de salida»).                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUÉ 'link' VA EN SU PROPIA FILA, NO CON LOS DEMÁS ────────────────┐
 * │ Reenviar el enlace (SPEC-014 §3) es ortogonal al estado de la rutina:  │
 * │ un cliente sin vincular lo necesita igual si está en NEW que si ya fue │
 * │ RECHAZADA. Mezclarlo en la fila de arriba dejaría hasta cinco botones  │
 * │ —uno de texto largo— apretados en un móvil.                            │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export function keyboardForDetail(c: ClientDetail): InlineKeyboard | null {
  if (c.versionId === null) return null;

  // La fila de abajo, ortogonal al estado: sin vincular, reenviar el enlace;
  // vinculado, pedirle que actualice sus datos (SPEC-027 regla 3). Nunca las
  // dos: sin vincular no hay a quién mandarle el formulario.
  const porEstado = actionsForState(c.versionState);
  if (porEstado.length === 0) return null;

  return buildKeyboard(porEstado, c.versionId, [
    c.linked ? 'reassess' : 'link',
  ]);
}

/**
 * Cuando lo escrito encaja con varios (SPEC-022 M4).
 *
 * Cada nombre es un botón que abre su ficha: antes era una lista de texto y
 * había que volver a escribir el comando con el apellido. Un botón por fila,
 * porque los nombres completos son largos. Se parte en páginas de 20 como
 * cualquier otra lista (regla 4): una que se corta en silencio deja fuera
 * justo a quien se buscaba.
 *
 * El texto de un botón NO es MarkdownV2: el nombre va tal cual.
 */
export function formatAmbiguous(
  clients: readonly { clientId: string; fullName: string }[],
): CommandMessage[] {
  return paginate(clients).map((pagina) => ({
    text: '🤔 Hay varios que encajan\\. ¿Cuál?',
    keyboard: {
      inline_keyboard: pagina.map((c) => [
        { text: c.fullName, callback_data: buildClientCallback(c.clientId) },
      ]),
    },
  }));
}

/**
 * SPEC-031 §3.6 — Ambigüedad al nombrar un cliente EN el mismo mensaje que
 * la rutina. Sin botones a propósito: un botón `cli:` solo abre la ficha, y
 * la rutina ya escrita se perdería. Se lista y se pide repetir el comando
 * entero con un nombre más específico.
 */
export function formatQuickCreateAmbiguous(
  clients: readonly { fullName: string }[],
): string {
  const nombres = clients.slice(0, PAGE_SIZE).map((c) => escapeMarkdownV2(c.fullName));

  return [
    `Hay varios clientes que encajan: ${nombres.join(', ')}\\.`,
    `Repite el comando con el nombre completo, por ejemplo /crear\\_rutina ${nombres[0]}\\.`,
  ].join('\n');
}

export function formatNotFound(suggestions: readonly { fullName: string }[]): string {
  if (suggestions.length === 0) return 'No tengo a nadie con ese nombre\\.';

  return [
    'No tengo a nadie con ese nombre\\. ¿Querías decir…?',
    '',
    ...suggestions.slice(0, PAGE_SIZE).map((c) => `• ${escapeMarkdownV2(c.fullName)}`),
  ].join('\n');
}

/**
 * `/pendientes` — una versión por mensaje, cada una con sus botones.
 *
 * Van sueltas y no en una lista porque el `callback_data` de un botón lleva
 * UN `versionId`: una lista con diez rutinas no podría tener diez botones de
 * aprobar que se distingan al pulsarlos.
 */
/**
 * SPEC-030 regla 14 — dos listas, no una: las `DRAFT` esperando que el
 * entrenador decida (como siempre) y las `APPROVED` esperando que el
 * cliente abra su enlace, con su propio botón. Antes esas segundas solo se
 * veían entrando a la ficha de cada cliente uno por uno.
 *
 * Los títulos de sección solo salen cuando hay DOS listas que distinguir:
 * con una sola, el título sobra.
 */
export function formatPending(
  versions: readonly PendingVersion[],
  awaitingLink: readonly PendingVersion[] = [],
): CommandMessage[] {
  if (versions.length === 0 && awaitingLink.length === 0) {
    return [{ text: '👍 No hay nada pendiente\\.' }];
  }

  const dosListas = versions.length > 0 && awaitingLink.length > 0;
  const mensajes: CommandMessage[] = [];

  if (versions.length > 0) {
    if (dosListas) mensajes.push({ text: '📋 *Esperando tu decisión*' });
    for (const v of versions) {
      mensajes.push({
        text:
          `⏳ *${escapeMarkdownV2(v.clientName)}* — rutina v${v.versionNumber}\n` +
          `Esperando desde hace ${v.daysWaiting} ${v.daysWaiting === 1 ? 'día' : 'días'}`,
        keyboard: buildKeyboard(DRAFT_ACTIONS, v.versionId),
      });
    }
  }

  if (awaitingLink.length > 0) {
    if (dosListas) mensajes.push({ text: '🔗 *Esperando que abran su enlace*' });
    for (const v of awaitingLink) {
      mensajes.push({
        text:
          `🔗 *${escapeMarkdownV2(v.clientName)}* — rutina v${v.versionNumber}\n` +
          `Aprobada hace ${v.daysWaiting} ${v.daysWaiting === 1 ? 'día' : 'días'}`,
        keyboard: buildKeyboard(['link'], v.versionId),
      });
    }
  }

  return mensajes;
}

/** `/checkins` — los que llevan días sin respuesta. */
export function formatStaleCheckins(checkins: readonly StaleCheckin[]): string {
  if (checkins.length === 0) return '✅ Todos los check\\-ins al día\\.';

  return [
    `📊 *Check\\-ins sin responder* \\(${checkins.length}\\)`,
    '',
    ...checkins
      .slice(0, PAGE_SIZE)
      .map(
        (k) =>
          `• ${escapeMarkdownV2(k.clientName)} — semana ${k.weekNumber} · ` +
          `${k.daysWaiting} días${k.reminded ? ' · ya recordado' : ''}`,
      ),
  ].join('\n');
}

/** `/ayuda`, y también la respuesta a un comando que no existe (regla 6). */
export const AYUDA = [
  '🤖 *Lo que puedo hacer*',
  '',
  '/clientes — todos, con su estado',
  '/cliente <nombre> — la ficha de uno',
  '/pendientes — rutinas esperando tu revisión',
  '/checkins — check\\-ins sin responder',
  '/ayuda — esto',
  '',
  'Buscar acepta trozos: `/cliente carl` encuentra a Carlos\\.',
].join('\n');

/** Regla 1: un cliente que escribe un comando no se lleva ningún dato. */
export const SOLO_ENTRENADOR = 'Eso solo lo puede consultar tu entrenador\\.';

/**
 * Regla 2. `/cliente` sin nombre.
 *
 * NO es «No tengo a nadie con ese nombre»: eso dice que buscó y no encontró,
 * y aquí no buscó nada. La diferencia se vio en uso real — Carlos escribió
 * `/cliente` a secas dos veces seguidas sin saber qué le faltaba.
 */
export const PIDE_NOMBRE_CLIENTE = 'Escribe el nombre: `/cliente Carlos`\\.';

/**
 * Lo que puede hacer un CLIENTE.
 *
 * ┌─ POR QUÉ EXISTE ───────────────────────────────────────────────────────┐
 * │ Antes, CUALQUIER comando de un cliente devolvía «eso solo lo puede     │
 * │ consultar tu entrenador». Incluso `/ayuda`. Así que alguien recién     │
 * │ vinculado no tenía forma de averiguar qué podía hacer: probaba a       │
 * │ ciegas y chocaba con el mismo muro.                                    │
 * │                                                                        │
 * │ Se termina diciendo que escriba, porque lo demás son botones y los     │
 * │ botones no se buscan: aparecen.                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
/** Las líneas de comandos, compartidas por `AYUDA_CLIENTE` y `SIN_PREGUNTA_PENDIENTE`. */
const COMANDOS_CLIENTE = [
  '/rutina — ver tu rutina actual',
  // SPEC-030: pedirlo también por comando, no solo desde el botón. El guion
  // bajo se escapa: fuera de un bloque de código es un especial de MarkdownV2.
  '/cambio\\_rutina — pedir un cambio a tu rutina',
  // SPEC-027: sabe antes que nadie cuándo le cambió algo.
  '/actualizar\\_datos — cambiar tus datos \\(días, tiempo, objetivo, lesiones…\\)',
  '/ayuda — esto',
];

export const AYUDA_CLIENTE = [
  '🤖 *Lo que puedes hacer*',
  '',
  ...COMANDOS_CLIENTE,
  '',
  'Cada lunes te llega un check\\-in de tres preguntas\\.',
  'Y en tu rutina tienes botones para decir si te sirve o pedir un cambio\\.',
  '',
  'Cualquier otra cosa, háblalo con tu entrenador\\.',
].join('\n');

/**
 * SPEC-030 regla 8 — ningún mensaje suelto del cliente se queda sin
 * respuesta. Sale cuando el texto no era ni la molestia del check\-in ni el
 * detalle de una solicitud de cambio.
 */
export const SIN_PREGUNTA_PENDIENTE = [
  'No tengo ninguna pregunta pendiente contigo 🙂',
  '',
  ...COMANDOS_CLIENTE,
].join('\n');

/** Vinculado, pero su entrenador todavía no le ha mandado nada. */
export const SIN_RUTINA_TODAVIA = [
  '⏳ Todavía no tienes una rutina\\.',
  '',
  'Tu entrenador la está preparando\\. En cuanto esté, te llega aquí mismo\\.',
].join('\n');
