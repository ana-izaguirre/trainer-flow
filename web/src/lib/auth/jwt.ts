/**
 * Sesión del panel: un JWT propio (SPEC-033 §3.3), no la sesión de Supabase
 * Auth (este proyecto no la usa) ni ningún secreto que el bot ya tenga —
 * cada secreto, un solo uso (CLAUDE.md, sección Secretos).
 *
 * `jose` en vez de `jsonwebtoken`: corre igual en el middleware (Edge
 * Runtime) y en las Route Handlers (Node), sin depender de `node:crypto`
 * completo.
 */
import { SignJWT, jwtVerify, errors } from "jose";
import { requireEnv } from "../env";

const SESSION_DURATION = "7d";
export const SESSION_COOKIE = "panel_session";

export interface SessionClaims {
  readonly profileId: string;
  readonly role: "trainer";
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("PANEL_JWT_SECRET"));
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secretKey());
}

/** `null` ante cualquier token inválido, expirado o ajeno — nunca lanza. */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.role !== "trainer" || typeof payload.profileId !== "string") return null;
    return { profileId: payload.profileId, role: "trainer" };
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}
