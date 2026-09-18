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
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildKeyboard, type InlineKeyboard } from '../telegram/keyboard.ts';
import { DRAFT_ACTIONS } from '../telegram/keyboard.ts';

/** Regla 4. Veinte líneas caben en una pantalla sin hacer scroll eterno. */
export const PAGE_SIZE = 20;

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

/** Cuando lo escrito no identifica a nadie, o a varios. */
export function formatAmbiguous(clients: readonly { fullName: string }[]): string {
  return [
    '🤔 Hay varios que encajan\\. ¿Cuál?',
    '',
    ...clients.slice(0, PAGE_SIZE).map((c) => `• ${escapeMarkdownV2(c.fullName)}`),
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
export function formatPending(versions: readonly PendingVersion[]): CommandMessage[] {
  if (versions.length === 0) {
    return [{ text: '✅ Nada pendiente de revisar\\.' }];
  }

  return versions.map((v) => ({
    text:
      `⏳ *${escapeMarkdownV2(v.clientName)}* — rutina v${v.versionNumber}\n` +
      `Esperando desde hace ${v.daysWaiting} ${v.daysWaiting === 1 ? 'día' : 'días'}`,
    keyboard: buildKeyboard(DRAFT_ACTIONS, v.versionId),
  }));
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
