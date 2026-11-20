/**
 * El lado de lectura de SPEC-033, reusando el dominio de `_core/` tal cual
 * (§3.2 de la spec): los mismos tipos, reusados desde `_core/ports/query-ports.ts`,
 * y las MISMAS funciones RPC de Postgres que ya usa el bot.
 *
 * Esto NO reusa `_shared/db.ts` directo: ese archivo importa
 * `npm:@supabase/supabase-js` al estilo Deno, que no resuelve bajo Node/Next.js
 * (la "regla del híbrido" de CLAUDE.md). Lo que se duplica es el glue
 * mecánico fila→tipo, nunca una regla de negocio ni la autorización.
 */
import type {
  ClientDetail,
  ClientSummary,
  PendingVersion,
  StaleCheckin,
} from "@core/ports/query-ports.ts";
import type { Level } from "@core/domain/assessment.ts";
import type { VersionState } from "@core/domain/version.ts";
import type { ChangeReason } from "@core/domain/change-request.ts";
import type { Database } from "@core/database.types.ts";
import type { Db } from "./supabase";

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

type ResumenFila = Pick<
  Database["public"]["Functions"]["trainer_clients"]["Returns"][number],
  "client_id" | "full_name" | "version_state" | "version_number" | "linked" | "pending_checkin_days"
>;

function leerResumen(fila: ResumenFila): ClientSummary {
  return {
    clientId: fila.client_id as string,
    fullName: fila.full_name as string,
    versionState: (fila.version_state as VersionState | null) ?? null,
    versionNumber: toNumberOrNull(fila.version_number),
    linked: fila.linked === true,
    pendingCheckinDays: toNumberOrNull(fila.pending_checkin_days),
  };
}

export interface WebQueryRepo {
  clients(trainerId: string): Promise<readonly ClientSummary[]>;
  clientDetail(clientId: string): Promise<ClientDetail | null>;
  pendingVersions(trainerId: string): Promise<readonly PendingVersion[]>;
  awaitingLink(trainerId: string): Promise<readonly PendingVersion[]>;
  staleCheckins(trainerId: string, minDays: number): Promise<readonly StaleCheckin[]>;
}

export function createQueryRepo(db: Db): WebQueryRepo {
  return {
    async clients(trainerId) {
      const { data, error } = await db.rpc("trainer_clients", { p_trainer_id: trainerId });
      if (error !== null) throw new Error(`No se pudo leer la cartera: ${error.code}`);
      return (data ?? []).map((fila) => leerResumen(fila));
    },

    async clientDetail(clientId) {
      const { data, error } = await db
        .rpc("trainer_client_detail", { p_client_id: clientId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la ficha: ${error.code}`);
      if (data === null) return null;

      const fila = data;
      const respuestas = fila.last_answers as Record<string, unknown> | null;
      const semana = fila.last_week_number;

      return {
        ...leerResumen(fila),
        versionId: (fila.version_id as string | null) ?? null,
        goal: (fila.goal as string | null) ?? null,
        level: (fila.level as Level | null) ?? null,
        daysPerWeek: toNumberOrNull(fila.days_per_week),
        sessionMinutes: toNumberOrNull(fila.session_minutes),
        equipment: (fila.equipment as string | null) ?? null,
        hasLimitations: fila.has_limitations === true,
        sentDaysAgo: toNumberOrNull(fila.sent_days_ago),
        lastCheckin:
          respuestas === null || semana === null || semana === undefined
            ? null
            : {
                weekNumber: Number(semana),
                sessions: toNumberOrNull(respuestas["sessions"]),
                feeling: (respuestas["feeling"] as string | null) ?? null,
                discomfort: (respuestas["discomfort"] as string | null) ?? null,
              },
        openChangeRequest:
          fila.change_request_reason === null
            ? null
            : {
                reason: fila.change_request_reason as ChangeReason,
                daysAgo: Number(fila.change_request_days_ago),
              },
      };
    },

    async pendingVersions(trainerId) {
      const { data, error } = await db.rpc("trainer_pending_versions", { p_trainer_id: trainerId });
      if (error !== null) throw new Error(`No se pudieron leer las pendientes: ${error.code}`);
      return (data ?? []).map((fila) => ({
        versionId: fila.version_id as string,
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        daysWaiting: Number(fila.days_waiting),
      }));
    },

    async awaitingLink(trainerId) {
      const { data, error } = await db.rpc("trainer_awaiting_link", { p_trainer_id: trainerId });
      if (error !== null) throw new Error(`No se pudieron leer las que esperan enlace: ${error.code}`);
      return (data ?? []).map((fila) => ({
        versionId: fila.version_id as string,
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        daysWaiting: Number(fila.days_waiting),
      }));
    },

    async staleCheckins(trainerId, minDays) {
      const { data, error } = await db.rpc("trainer_stale_checkins", {
        p_trainer_id: trainerId,
        p_min_days: minDays,
      });
      if (error !== null) throw new Error(`No se pudieron leer los check-ins: ${error.code}`);
      return (data ?? []).map((fila) => ({
        clientName: fila.client_name as string,
        weekNumber: Number(fila.week_number),
        daysWaiting: Number(fila.days_waiting),
        reminded: fila.reminded === true,
      }));
    },
  };
}
