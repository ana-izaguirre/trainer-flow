import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/jwt";

/**
 * Autorización por rol, capa 1 de 2 (SPEC-033 §3.3): ¿puede entrar? La capa 2
 * — ¿esto es suyo? — vive en `_core/authorization.ts`, en cada ruta de datos,
 * nunca aquí: este archivo no sabe qué es un `trainer_id` ni un cliente.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token === undefined ? null : await verifySessionToken(token);

  if (claims === null) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set("x-panel-profile-id", claims.profileId);
  return response;
}

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
