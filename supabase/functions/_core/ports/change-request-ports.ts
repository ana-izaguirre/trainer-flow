/**
 * SPEC-010 — Lo que las solicitudes de cambio necesitan del exterior.
 *
 * ┌─ AQUÍ NO HAY NADA QUE TOQUE `workout_versions` ────────────────────────┐
 * │ La regla 4 dice que la versión anterior queda intacta: ni su           │
 * │ contenido, ni su estado, ni su `sent_at`. Este puerto no expone        │
 * │ ninguna operación que pudiera cambiarla, así que una solicitud no      │
 * │ puede mutar una rutina enviada aunque el código lo intentara.          │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { ChangeReason } from '../domain/change-request.ts';
import type { VersionRef } from '../domain/version.ts';

/** La versión sobre la que se pide el cambio, con su pertenencia. */
export interface VersionForRequest extends VersionRef {
  /** El plan al que colgar la v2. */
  readonly planId: string;
  readonly clientName: string;
  readonly versionNumber: number;
  readonly trainerChatId: number;
}

/** La solicitud, tal y como la ve el entrenador. */
export interface ChangeRequestView {
  readonly requestId: string;
  readonly versionId: string;
  readonly planId: string;
  readonly versionNumber: number;
  readonly state: 'OPEN' | 'RESOLVED';
  readonly reason: ChangeReason;
  /** Texto libre del cliente. Puede llevar datos de salud: nunca a logs. */
  readonly comment: string | null;
  readonly clientName: string;
  readonly trainerId: string;
  readonly sentDaysAgo: number | null;
}

/** Una solicitud esperando comentario, para decidir a quién va un texto. */
export interface OpenRequest {
  readonly requestId: string;
  readonly clientId: string;
  readonly hasComment: boolean;
  /** Cuándo se le preguntó. Compite con el `sent_at` del check-in. */
  readonly askedAt: Date;
}

export interface ChangeRequestRepo {
  findVersion(versionId: string): Promise<VersionForRequest | null>;

  /**
   * Crea la solicitud, o actualiza la abierta de esa versión.
   *
   * El `UNIQUE` parcial sobre `OPEN` es lo que impide dos: no una
   * comprobación previa, que dos pulsaciones simultáneas pasarían (regla 6).
   */
  request(versionId: string, clientId: string, reason: ChangeReason): Promise<string>;

  /** La abierta de este cliente, para atribuirle un texto libre. */
  openForClient(profileId: string): Promise<OpenRequest | null>;

  /** `false` si no es suya o ya se cerró. */
  addComment(requestId: string, clientId: string, comment: string): Promise<boolean>;

  findRequest(requestId: string): Promise<ChangeRequestView | null>;

  /**
   * La versión nueva sobre la que trabajar. Estado `NEW`: de ahí salen los
   * mismos tres caminos de SPEC-008, sin ninguno especial por ser revisión.
   */
  createRevision(planId: string, trainerId: string): Promise<string>;

  /** Registra el «me sirve». No cambia estado: `SENT` ya es terminal. */
  recordAccepted(versionId: string, clientId: string): Promise<void>;
}
