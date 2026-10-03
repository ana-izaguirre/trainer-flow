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
import type { VersionRef, VersionState } from '../domain/version.ts';

/** La versión sobre la que se pide el cambio, con su pertenencia. */
export interface VersionForRequest extends VersionRef {
  /** El plan al que colgar la v2. */
  readonly planId: string;
  readonly clientName: string;
  readonly versionNumber: number;
  readonly trainerChatId: number;
  /**
   * El estado y número de la versión VIGENTE del plan ahora mismo —
   * `workout_plans.current_version_id`, no esta `versionId`.
   *
   * Son el mismo valor que `state`/`versionNumber` mientras nadie empezó
   * una revisión todavía. Dejan de serlo en cuanto `startRevision` crea la
   * v2: a partir de ahí, dicen que ya hay una en marcha.
   */
  readonly currentVersionState: VersionState;
  readonly currentVersionNumber: number;
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
  readonly versionId: string;
  readonly reason: ChangeReason;
  readonly hasComment: boolean;
  /** Cuándo se le preguntó. Compite con el `sent_at` del check-in. */
  readonly askedAt: Date;
  /** Cuándo se creó. Es lo que se muestra como «hace N días» (SPEC-030). */
  readonly createdAt: Date;
}

/** SPEC-030 regla 2: si `created` es `false`, no se avisa al entrenador. */
export interface RequestResult {
  readonly id: string;
  readonly created: boolean;
}

/** SPEC-030 regla 4: `truncated` dice si sobró texto tras los 500 caracteres. */
export interface CommentResult {
  readonly saved: boolean;
  readonly truncated: boolean;
}

export interface ChangeRequestRepo {
  findVersion(versionId: string): Promise<VersionForRequest | null>;

  /**
   * Crea la solicitud, o deja intacta la que ya estaba abierta.
   *
   * El `UNIQUE` parcial sobre `OPEN` es lo que impide dos filas: no una
   * comprobación previa, que dos pulsaciones simultáneas pasarían. `created`
   * sale del propio `INSERT`, así que sigue siendo el índice quien decide
   * (SPEC-030 regla 2).
   */
  request(versionId: string, clientId: string, reason: ChangeReason): Promise<RequestResult>;

  /** La abierta de este cliente, para atribuirle un texto libre o su estado. */
  openForClient(profileId: string): Promise<OpenRequest | null>;

  /**
   * Vuelve a marcar la solicitud como recién preguntada, sin tocar el
   * motivo (SPEC-030 regla 5). `false` si ya no está abierta o no es suya.
   */
  touchAsk(requestId: string, clientId: string): Promise<boolean>;

  /** Añade el mensaje al comentario, hasta 500 caracteres (SPEC-030 regla 4). */
  addComment(requestId: string, clientId: string, comment: string): Promise<CommentResult>;

  findRequest(requestId: string): Promise<ChangeRequestView | null>;

  /**
   * La versión nueva sobre la que trabajar. Estado `NEW`: de ahí salen los
   * mismos tres caminos de SPEC-008, sin ninguno especial por ser revisión.
   */
  createRevision(planId: string, trainerId: string): Promise<string>;

  /** Registra el «me sirve». No cambia estado: `SENT` ya es terminal. */
  recordAccepted(versionId: string, clientId: string): Promise<void>;
}
