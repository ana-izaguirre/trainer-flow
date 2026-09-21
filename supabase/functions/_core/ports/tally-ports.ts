/**
 * Lo que el flujo del webhook de Tally necesita del mundo exterior.
 *
 * Mismo patrón que `telegram-ports.ts`: `_core` declara qué necesita, no cómo
 * se consigue. Quien las implementa vive en `_shared`.
 */

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
