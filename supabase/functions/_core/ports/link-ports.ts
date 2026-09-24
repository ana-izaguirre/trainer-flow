/**
 * SPEC-014 §3 — Lo que reenviar el enlace necesita del exterior.
 */
import type { ClientRef } from '../domain/version.ts';

export interface ClientForResend {
  /** De quién es. Sin esto no se puede autorizar (SPEC-013). */
  readonly client: ClientRef;
  readonly fullName: string;
  readonly linked: boolean;
  /** Credencial: nunca se loguea (SPEC-001 regla 6, SPEC-014 §6). */
  readonly linkToken: string;
}

export interface LinkResendRepo {
  /**
   * El cliente dueño de esta versión — se resuelve por `versionId` porque es
   * lo que viaja en el `callback_data` de la ficha, igual que
   * `assessment_for_version` (SPEC-015). El enlace vive en el CLIENTE, no en
   * la versión, así que cualquiera de sus versiones resuelve al mismo.
   */
  findClientForVersion(versionId: string): Promise<ClientForResend | null>;
}
