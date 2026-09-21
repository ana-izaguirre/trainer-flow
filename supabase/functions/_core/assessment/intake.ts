/**
 * SPEC-015 — La ficha de admisión: todo lo que contestó, como informe.
 *
 * ┌─ EL ÚNICO FLUJO QUE NO ESCRIBE NADA ───────────────────────────────────┐
 * │ Leer la evaluación no transiciona la versión ni deja evento. El        │
 * │ entrenador la abre las veces que quiera, antes o después de decidir.   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ EL ÚNICO MENSAJE CON `limitationsDetail` ─────────────────────────────┐
 * │ El aviso de nueva evaluación dice QUE hay limitaciones, no cuáles,     │
 * │ porque llega solo y se ve en la pantalla de bloqueo. Esto llega        │
 * │ porque él pulsó un botón: tiene el chat abierto y está mirando.        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { canModifyVersion } from '../authorization.ts';
import type { Level } from '../domain/assessment.ts';
import type { Identity } from '../domain/identity.ts';
import type { IntakeForVersion, IntakeRepo } from '../ports/intake-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';

export interface IntakeDeps {
  readonly repo: IntakeRepo;
  readonly sender: TelegramSender;
}

export type IntakeOutcome =
  | { readonly kind: 'shown'; readonly versionId: string }
  /** No existe, no es suya, o no hubo formulario. Los tres suenan igual. */
  | { readonly kind: 'rejected'; readonly reason: string };

const NIVEL: Readonly<Record<Level, string>> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};

/** `dd/mm/aaaa`, que es como se lee una fecha de admisión. */
function fecha(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

/** Regla 4: un campo vacío no se pinta como «—», se omite. */
function bloque(titulo: string, cuerpo: string | null): readonly string[] {
  const limpio = cuerpo?.trim();
  return limpio === undefined || limpio === ''
    ? []
    : ['', `*${titulo}*`, escapeMarkdownV2(limpio)];
}

export function formatIntake(intake: IntakeForVersion): string {
  const lines: string[] = [
    `📄 *Evaluación de ${escapeMarkdownV2(intake.clientName)}*`,
    `_Recibida el ${escapeMarkdownV2(fecha(intake.submittedAt))}_`,
    '',
    `🎯 *Objetivo:* ${escapeMarkdownV2(intake.goal)}`,
    `📊 *Nivel:* ${NIVEL[intake.level]}`,
    `📅 *Frecuencia:* ${intake.daysPerWeek} días · ${intake.sessionMinutes} min por sesión`,
    intake.equipmentDetail === null || intake.equipmentDetail.trim() === ''
      ? `🏋️ *Material:* ${escapeMarkdownV2(intake.equipment)}`
      : `🏋️ *Material:* ${escapeMarkdownV2(intake.equipment)}\n_${escapeMarkdownV2(intake.equipmentDetail)}_`,
  ];

  // El detalle va justo debajo de la bandera, que es donde se busca.
  if (intake.hasLimitations) {
    lines.push('', '⚠️ *Limitaciones declaradas*');
    lines.push(
      intake.limitationsDetail === null || intake.limitationsDetail.trim() === ''
        ? '_Marcó que tiene, pero no detalló cuáles\\._'
        : escapeMarkdownV2(intake.limitationsDetail),
    );
  } else {
    lines.push('', '✅ *Sin limitaciones declaradas*');
  }

  // SPEC-016: lo más importante primero. Si tiene una enfermedad crónica, es
  // lo que decide cómo se programa todo lo demás.
  if (intake.chronicConditions !== null && intake.chronicConditions.trim() !== '') {
    lines.push(
      '',
      '🩺 *Condiciones que tiene*',
      escapeMarkdownV2(intake.chronicConditions),
    );
  }

  // Aparte de lo propio: no es lo mismo tenerla que tenerla un familiar.
  lines.push(...bloque('👪 En su familia', intake.familyConditions));
  lines.push(...bloque('💊 Fármacos', intake.medications));

  // Los datos físicos, en una línea: se leen juntos o no se leen.
  const fisicos = [
    intake.age === null
      ? null
      : intake.birthDate === null
        ? `${intake.age} años`
        : // La fecha al lado de la edad: dentro de dos años la edad sola
          // mentiría, y con la fecha se ve de cuándo es el dato.
          `${intake.age} años (${intake.birthDate})`,
    intake.weightKg === null ? null : `${intake.weightKg} kg`,
    intake.heightCm === null ? null : `${intake.heightCm} cm`,
  ].filter((x): x is string => x !== null);

  if (fisicos.length > 0 || intake.gender !== null) {
    const partes = intake.gender === null ? fisicos : [intake.gender, ...fisicos];
    lines.push('', `👤 ${escapeMarkdownV2(partes.join(' · '))}`);

    // Dice si el peso es fiable. Va pegado a los datos, no suelto.
    if (intake.lastWeighed !== null && intake.lastWeighed.trim() !== '') {
      lines.push(`_Último pesaje: ${escapeMarkdownV2(intake.lastWeighed)}_`);
    }
  }

  lines.push(...bloque('Etapa', intake.menopauseStage));
  lines.push(...bloque('Por qué abandonó antes', intake.quitReasons));
  lines.push(...bloque('Estilo de vida', intake.lifestyle));
  lines.push(...bloque('Lo que quiere que sepas', intake.notes));

  return lines.join('\n');
}

/**
 * 📄 — se muestra la ficha.
 *
 * La pertenencia se comprueba antes de enseñar un solo campo: se llega desde
 * un `callback_data`, y eso lo fabrica cualquiera (SPEC-013 regla 1).
 */
export async function showIntake(
  versionId: string,
  actor: Identity,
  deps: IntakeDeps,
): Promise<IntakeOutcome> {
  const intake = await deps.repo.findIntake(versionId);

  if (intake === null || !canModifyVersion(actor, intake).allowed) {
    // «No existe», «no es tuya» y «no hubo formulario» salen por la misma
    // puerta: quien prueba identificadores no aprende cuáles son reales.
    await deps.sender.sendMessage(
      actor.telegramChatId,
      'No tengo una evaluación que enseñarte para esa rutina\\.',
    );
    return { kind: 'rejected', reason: 'no existe, no es suya o no hubo formulario' };
  }

  await deps.sender.sendMessage(actor.telegramChatId, formatIntake(intake));
  return { kind: 'shown', versionId };
}
