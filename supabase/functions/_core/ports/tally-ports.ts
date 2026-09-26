/**
 * Lo que el flujo del webhook de Tally necesita del mundo exterior.
 *
 * Mismo patrón que `telegram-ports.ts`: `_core` declara qué necesita, no cómo
 * se consigue. Quien las implementa vive en `_shared`.
 */
import type { ComparableAssessment } from '../assessment/changes.ts';
import type { VersionState } from '../domain/version.ts';

/** Lo que `ingest_assessment` necesita para crear las cuatro filas. */
export interface AssessmentToIngest {
  readonly trainerId: string;
  readonly fullName: string;
  readonly linkToken: string;
  /** El payload ya redactado: sin las URLs con credencial. */
  readonly rawPayload: unknown;
  readonly goal: string;
  readonly level: string;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  readonly hasLimitations: boolean;
  readonly limitationsDetail: string | null;
  readonly lifestyle: string | null;
  readonly notes: string | null;

  // ── SPEC-016 ────────────────────────────────────────────────────────────
  readonly gender: string | null;
  readonly age: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly lastWeighed: string | null;
  readonly quitReasons: string | null;
  readonly menopauseStage: string | null;
  readonly chronicConditions: string | null;
  readonly birthDate: string | null;
  readonly medications: string | null;
  readonly equipmentDetail: string | null;
}

/**
 * SPEC-027: lo mismo, para un cliente que YA existe. No lleva entrenador,
 * nombre ni `link_token`: el cliente lo dice el token, no el formulario.
 */
export interface AssessmentUpdateToIngest
  extends Omit<AssessmentToIngest, 'trainerId' | 'fullName' | 'linkToken'> {
  /** Credencial: nunca se loguea. La base compara su hash. */
  readonly token: string;
}

/** Lo que devuelve la ingesta con token, para avisar a los dos. */
export interface UpdatedAssessment {
  readonly clientId: string;
  readonly clientName: string;
  /** `null` si ya no está vinculado: entonces no se le escribe. */
  readonly clientChatId: number | null;
  readonly assessmentId: string;
  /** La evaluación ANTERIOR, para decir qué cambió. `null` si no había. */
  readonly previous: ComparableAssessment | null;
  readonly planId: string | null;
  /** La versión vigente y su estado: deciden los botones del aviso. */
  readonly versionId: string | null;
  readonly versionState: VersionState | null;
}

export interface IngestedIds {
  readonly clientId: string;
  readonly planId: string;
  readonly versionId: string;
}

export interface TallyRepo {
  /**
   * Registra el evento. Devuelve `false` si ya se había procesado.
   *
   * La idempotencia es el `UNIQUE (source, external_id)` de la base de datos,
   * no una comprobación previa: dos entregas simultáneas del mismo `eventId`
   * no pueden pasar las dos.
   */
  claimEvent(externalId: string, payload: unknown, requestId: string): Promise<boolean>;

  markProcessed(externalId: string): Promise<void>;

  /**
   * El entrenador. En V1 hay exactamente uno.
   *
   * `null` si todavía no tiene perfil, y entonces no se puede crear ningún
   * cliente: `clients.trainer_id` es NOT NULL.
   */
  findTrainer(): Promise<{ readonly profileId: string; readonly chatId: number } | null>;

  /** Crea cliente, evaluación, plan y primera versión. Todo o nada. */
  ingestAssessment(input: AssessmentToIngest): Promise<IngestedIds>;

  /**
   * SPEC-027: consume el token y guarda la evaluación para SU cliente.
   * `null` si el token no vale (inventado, usado o vencido): entonces no se
   * escribió nada, y quien llama sigue por el camino de siempre.
   */
  ingestAssessmentUpdate(input: AssessmentUpdateToIngest): Promise<UpdatedAssessment | null>;
}

/**
 * Verifica la firma del cuerpo crudo.
 *
 * Está fuera de `_core` porque calcular un HMAC necesita `crypto.subtle`, y
 * el ADR-001 mantiene el dominio sin APIs de plataforma. Lo que `_core` sí
 * garantiza es **cuándo** se llama: antes de absolutamente todo lo demás.
 */
export interface SignatureVerifier {
  /** `true` si la firma corresponde al cuerpo. Comparación en tiempo constante. */
  matches(rawBody: string, signature: string): Promise<boolean>;
}
