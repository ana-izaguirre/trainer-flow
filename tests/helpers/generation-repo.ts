/**
 * Un `GenerationRepo` contra PostgreSQL de verdad, para los E2E.
 *
 * ┌─ POR QUÉ NO SE USA EL DE `_shared` ────────────────────────────────────┐
 * │ Aquel habla por PostgREST, que necesita el stack de Supabase levantado.│
 * │ Este ejecuta el MISMO SQL con el driver directo.                       │
 * │                                                                        │
 * │ No es un doble: las funciones SQL, la máquina de estados y la          │
 * │ validación son las reales. Lo único que cambia es el transporte, que   │
 * │ es justo lo que un E2E de dominio no necesita probar.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Client } from 'pg';
import type {
  GenerationRepo,
  VersionForGeneration,
} from '../../supabase/functions/_core/ports/generation-ports.ts';
import type { Level } from '../../supabase/functions/_core/domain/assessment.ts';
import type { VersionState } from '../../supabase/functions/_core/domain/version.ts';

export function createTestGenerationRepo(db: Client, requestId: string): GenerationRepo {
  return {
    async findVersion(versionId): Promise<VersionForGeneration | null> {
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT * FROM version_for_generation($1)`,
        [versionId],
      );
      const fila = rows[0];
      if (fila === undefined) return null;

      const daysPerWeek = Number(fila['days_per_week']);

      return {
        versionId: fila['version_id'] as string,
        state: fila['state'] as VersionState,
        clientName: fila['client_name'] as string,
        versionNumber: Number(fila['version_number']),
        request: {
          goal: fila['goal'] as string,
          level: fila['level'] as Level,
          gender: (fila['gender'] as string | null) ?? null,
          age: fila['age'] === null ? null : Number(fila['age']),
          weightKg: fila['weight_kg'] === null ? null : Number(fila['weight_kg']),
          heightCm: fila['height_cm'] === null ? null : Number(fila['height_cm']),
          quitReasons: (fila['quit_reasons'] as string | null) ?? null,
          menopauseStage: (fila['menopause_stage'] as string | null) ?? null,
          daysPerWeek,
          sessionMinutes: Number(fila['session_minutes']),
          equipment: fila['equipment'] as string,
          limitations: (fila['limitations'] as string | null) ?? null,
          instruction: null,
        },
        constraints: { daysPerWeek, hasLimitations: fila['has_limitations'] === true },
        trainerChatId: Number(fila['trainer_chat_id']),
      };
    },

    async recentGenerations(windowMinutes) {
      const { rows } = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM ai_generations
          WHERE created_at > now() - make_interval(mins => $1)`,
        [windowMinutes],
      );
      return rows.map((r) => r.created_at);
    },

    async startGeneration(record) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO ai_generations (provider, model, operation, version_id, request_id, status)
         VALUES ($1, $2, 'generate', $3, $4, 'GENERATING') RETURNING id`,
        [record.provider, record.model, record.versionId, requestId],
      );
      return Number(rows[0]!.id);
    },

    async finishGeneration(id, outcome) {
      if (outcome.status === 'SUCCEEDED') {
        await db.query(
          `UPDATE ai_generations
              SET status = 'SUCCEEDED', tokens_in = $2, tokens_out = $3,
                  latency_ms = $4, finished_at = now()
            WHERE id = $1`,
          [id, outcome.usage.tokensIn, outcome.usage.tokensOut, outcome.latencyMs],
        );
        return;
      }

      await db.query(
        `UPDATE ai_generations
            SET status = 'FAILED', failure_reason = $2, latency_ms = $3, finished_at = now()
          WHERE id = $1`,
        [id, outcome.failureReason, outcome.latencyMs],
      );
    },

    async transition(versionId, from, to) {
      const { rows } = await db.query<{ apply_version_transition: boolean }>(
        `SELECT apply_version_transition($1, $2, $3, 'system')`,
        [versionId, from, to],
      );
      return rows[0]!.apply_version_transition;
    },

    async saveContent(versionId, workout) {
      await db.query(`UPDATE workout_versions SET content = $2 WHERE id = $1`, [
        versionId,
        JSON.stringify(workout),
      ]);
    },
  };
}
