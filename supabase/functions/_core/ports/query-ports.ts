/**
 * SPEC-007 — Lo que las consultas del entrenador necesitan del exterior.
 *
 * ┌─ AQUÍ NO HAY NI UNA ESCRITURA, Y ESO ES LA GARANTÍA ───────────────────┐
 * │ «Los comandos son de solo lectura» no es una nota en la spec: es que   │
 * │ este puerto no expone nada con lo que escribir. Un comando no puede    │
 * │ aprobar una rutina aunque alguien lo intente, porque no tiene con qué. │
 * │                                                                        │
 * │ Los botones de `/pendientes` sí llevan a acciones que escriben, y esas │
 * │ pasan por `handleAction`, con su propia autorización.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Todo lo que devuelven estas consultas ya viene filtrado por `trainer_id`:
 * el entrenador solo ve a los suyos (SPEC-007 §7).
 */
import type { Level } from '../domain/assessment.ts';
import type { ChangeReason } from '../domain/change-request.ts';
import type { VersionState } from '../domain/version.ts';
import type { VersionForDelivery } from './delivery-ports.ts';

/** Una línea de `/clientes`. Lo justo para pintar la lista. */
export interface ClientSummary {
  readonly clientId: string;
  readonly fullName: string;
  /** `null` si nunca se le creó una rutina. */
  readonly versionState: VersionState | null;
  readonly versionNumber: number | null;
  readonly linked: boolean;
  /** Días desde el último check-in sin responder. `null` si no hay ninguno. */
  readonly pendingCheckinDays: number | null;
}

/** La ficha de `/cliente <nombre>`. */
export interface ClientDetail extends ClientSummary {
  /**
   * La versión vigente del plan. `null` si el cliente todavía no tiene
   * ninguna. Es lo que necesita `keyboardForDetail` para construir los
   * botones de la ficha (SPEC-007 regla 7): sin esto, la ficha solo podía
   * mostrar texto y nunca ofrecer una acción.
   */
  readonly versionId: string | null;
  readonly goal: string | null;
  readonly level: Level | null;
  readonly daysPerWeek: number | null;
  readonly sessionMinutes: number | null;
  readonly equipment: string | null;
  /**
   * Si declaró limitaciones. **El detalle no viaja**: la ficha se lee de un
   * vistazo en el móvil y el texto crudo vive en la rutina, que es donde el
   * entrenador lo necesita.
   */
  readonly hasLimitations: boolean;
  readonly sentDaysAgo: number | null;
  readonly lastCheckin: {
    readonly weekNumber: number;
    readonly sessions: number | null;
    readonly feeling: string | null;
    readonly discomfort: string | null;
  } | null;
  /**
   * SPEC-030 regla 11: la solicitud de cambio abierta, si hay una. Solo
   * motivo y días: el comentario puede llevar datos de salud y no va aquí.
   */
  readonly openChangeRequest: { readonly reason: ChangeReason; readonly daysAgo: number } | null;
}

/** Una versión esperando decisión, para `/pendientes`. */
export interface PendingVersion {
  readonly versionId: string;
  readonly clientName: string;
  readonly versionNumber: number;
  readonly daysWaiting: number;
}

/** Un check-in sin responder, para `/checkins`. */
export interface StaleCheckin {
  readonly clientName: string;
  readonly weekNumber: number;
  readonly daysWaiting: number;
  readonly reminded: boolean;
}

export interface QueryRepo {
  clients(trainerId: string): Promise<readonly ClientSummary[]>;
  clientDetail(clientId: string): Promise<ClientDetail | null>;
  pendingVersions(trainerId: string): Promise<readonly PendingVersion[]>;
  /**
   * SPEC-030 regla 14: `APPROVED` esperando que el cliente abra su enlace.
   * Misma forma que `pendingVersions` — es la segunda lista de `/pendientes`.
   */
  awaitingLink(trainerId: string): Promise<readonly PendingVersion[]>;
  /** Los `PENDING` de más de `minDays` días. */
  staleCheckins(trainerId: string, minDays: number): Promise<readonly StaleCheckin[]>;
  /**
   * La rutina vigente del CLIENTE que escribe (SPEC-023).
   *
   * Toma su `profileId`, no un `clientId`: la identidad ya viene verificada
   * por Telegram, y sin un parámetro de cliente **no hay forma de pedir la de
   * otro**.
   */
  clientRoutine(profileId: string): Promise<VersionForDelivery | null>;
}
