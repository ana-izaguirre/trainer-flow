import type { VersionState } from "@core/domain/version.ts";

/**
 * Presentación visual del panel — no es la misma preocupación que
 * `_core/commands/format.ts` (que arma frases de chat, no etiquetas de UI),
 * así que no se reusa de ahí: cada superficie (bot, panel) formatea lo suyo.
 */
export const VERSION_STATE_LABELS: Readonly<Record<VersionState, string>> = {
  NEW: "Nueva",
  GENERATING: "Generando…",
  DRAFT: "Borrador",
  APPROVED: "Aprobada",
  SENT: "Enviada",
  REJECTED: "Rechazada",
};

export function versionStateBadgeVariant(
  state: VersionState,
): "default" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "SENT":
      return "default";
    case "APPROVED":
      return "secondary";
    case "REJECTED":
      return "destructive";
    default:
      return "outline";
  }
}
