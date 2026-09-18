/**
 * SPEC-006 — Lo que el check-in semanal necesita del exterior.
 */
import type { VersionState } from '../domain/version.ts';
import type { CheckinAnswers } from '../checkin/answers.ts';

/** Un cliente que quizá toque preguntarle esta semana. */
export interface CheckinCandidate {
  readonly clientId: string;
  readonly clientName: string;
  /** `null` si no canjeó su enlace: no hay dónde preguntarle. */
  readonly clientChatId: number | null;
  readonly versionId: string;
  readonly state: VersionState;
  readonly sentAt: Date;
  /**
   * La última semana de la que ya SALIÓ un check-in.
   *
   * Se cuenta sobre los que tienen `sent_at`, no sobre las filas creadas: un
   * envío que falló deja la fila sin fecha y la semana se vuelve a intentar.
   */
  readonly lastWeekSent: number;
}

export interface CheckinToRemind {
  readonly checkinId: string;
  readonly clientChatId: number;
  readonly weekNumber: number;
  readonly state: 'PENDING' | 'COMPLETED';
  readonly sentAt: Date;
  readonly reminderSentAt: Date | null;
}

/** Un check-in con lo justo para decidir si quien contesta puede hacerlo. */
export interface CheckinForReply {
  readonly checkinId: string;
  /**
   * De quién es. Se compara contra la identidad resuelta del webhook, nunca
   * contra nada que venga en el `callback_data` (CA-7).
   */
  readonly clientProfileId: string | null;
  readonly clientName: string;
  readonly weekNumber: number;
  readonly state: 'PENDING' | 'COMPLETED';
  readonly answers: CheckinAnswers;
  /** Cuándo se le preguntó. Compite con otras preguntas abiertas (SPEC-010 §3). */
  readonly sentAt: Date;
  readonly trainerChatId: number;
  /** Para decir «3 de 4». `null` si la rutina no vino de un formulario. */
  readonly daysPerWeek: number | null;
}

export interface CheckinRepo {
  /** Los clientes con una rutina entregada. El dominio decide a cuáles toca. */
  candidates(): Promise<readonly CheckinCandidate[]>;

  /**
   * Crea el check-in de esa semana, o devuelve el que ya existía.
   *
   * El `UNIQUE (client_id, version_id, week_number)` es lo que impide que dos
   * pasadas del cron creen dos (regla 3). No una comprobación previa, que dos
   * ejecuciones simultáneas pasarían las dos.
   */
  createCheckin(clientId: string, versionId: string, weekNumber: number): Promise<string>;

  /** Marca que SALIÓ. Se llama después de enviar, nunca antes. */
  markSent(checkinId: string): Promise<void>;

  /** Los que llevan 48 horas sin respuesta. El dominio decide cuáles avisar. */
  pendingReminders(): Promise<readonly CheckinToRemind[]>;

  markReminded(checkinId: string): Promise<void>;

  findCheckin(checkinId: string): Promise<CheckinForReply | null>;

  /**
   * El check-in abierto de este cliente, para atribuirle un texto libre.
   *
   * Un mensaje suelto solo se lee como «molestia» si hay uno esperándola.
   */
  findOpenCheckin(profileId: string): Promise<CheckinForReply | null>;

  /**
   * Guarda las respuestas. `completed` pasa el estado a COMPLETED.
   *
   * Es información de salud: no se loguea (SPEC-006 §7).
   */
  saveAnswers(checkinId: string, answers: CheckinAnswers, completed: boolean): Promise<void>;
}
