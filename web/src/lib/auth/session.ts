import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE, type SessionClaims } from "./jwt";

/**
 * Para Server Components y Route Handlers: vuelve a verificar el JWT desde
 * la cookie directamente, sin confiar en el header que deja el middleware
 * (SPEC-033 §3.3 capa 1). El middleware ya garantiza que no se llega hasta
 * aquí sin sesión válida — esto solo recupera el `profileId` para que la
 * página filtre sus datos por él (capa 2, en `_core/authorization.ts`).
 */
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined) return null;
  return verifySessionToken(token);
}
