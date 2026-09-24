/**
 * SPEC-002 §11 — Desatascar una GENERATING que murió a medias.
 *
 * ┌─ POR QUÉ ESTO EXISTE ───────────────────────────────────────────────────┐
 * │ `NEW → GENERATING` la hace `generate-version`, y ESA MISMA función es   │
 * │ la única que sabe devolverla a `NEW` cuando algo sale mal               │
 * │ (`GENERATION_FAILED`, ver `ai/generate-version.ts`). Si la función      │
 * │ muere ANTES de llegar a esa línea —el timeout de la plataforma, un      │
 * │ OOM, cualquier fallo que no pase por su propio try/catch—, la versión   │
 * │ se queda en GENERATING para siempre. No hay botón: mientras trabaja de  │
 * │ verdad, no debería haber ninguno (docs/STATE-MACHINE.md).               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Mismo patrón que SPEC-006 (`checkin/send.ts`): un cron llama a esto cada
 * pocos minutos. Correrlo de más no duplica ni pisa nada — la guarda de
 * concurrencia de `transition` es la misma que usa cualquier otro camino.
 */
import type { TelegramSender } from '../ports/telegram-ports.ts';
import type { SweepRepo } from '../ports/sweep-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';

export interface SweepDeps {
  readonly repo: SweepRepo;
  readonly sender: TelegramSender;
  /** Minutos en GENERATING antes de considerarla atascada. Config, no secreto. */
  readonly minMinutes: number;
}

export interface SweepResult {
  readonly checked: number;
  readonly recovered: number;
}

export async function sweepStaleGenerations(deps: SweepDeps): Promise<SweepResult> {
  const candidatas = await deps.repo.staleGenerations(deps.minMinutes);
  let recovered = 0;

  for (const version of candidatas) {
    // Si la generación real terminó un instante antes de esta pasada, esto
    // devuelve `false`: no se manda ningún aviso de más porque no hay nada
    // que arreglar.
    const volvio = await deps.repo.transition(version.versionId, 'GENERATING', 'NEW');
    if (!volvio) continue;

    recovered += 1;
    await deps.sender.sendMessage(
      version.trainerChatId,
      `⚠️ La generación de ${escapeMarkdownV2(version.clientName)} llevaba más de ` +
        `${version.minutesStuck} minutos sin terminar\\. La devolví a NEW: puedes reintentar, ` +
        `usar una plantilla o escribirla a mano\\.`,
    );
  }

  return { checked: candidatas.length, recovered };
}
