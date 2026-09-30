/**
 * SPEC-030 regla 13 — Lo que el aviso de enlace sin abrir necesita del exterior.
 */
export interface AwaitingLinkReminder {
  readonly versionId: string;
  readonly trainerChatId: number;
  readonly clientName: string;
}

export interface LinkReminderRepo {
  /** `APPROVED`, sin vincular, aprobadas hace `minHours` o más, sin aviso previo. */
  awaitingReminder(minHours: number): Promise<readonly AwaitingLinkReminder[]>;

  /** Un solo aviso por versión: la segunda llamada no pisa la fecha de la primera. */
  markReminded(versionId: string): Promise<void>;
}
