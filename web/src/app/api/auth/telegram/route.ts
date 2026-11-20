import { NextResponse } from "next/server";
import { verifyTelegramWidget, type TelegramWidgetPayload } from "@/lib/auth/telegram-verify";
import { signSessionToken, SESSION_COOKIE } from "@/lib/auth/jwt";
import { requireEnv } from "@/lib/env";
import { createDb } from "@/lib/supabase";

function isWidgetPayload(body: unknown): body is TelegramWidgetPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.id === "number" &&
    typeof b.first_name === "string" &&
    typeof b.auth_date === "number" &&
    typeof b.hash === "string"
  );
}

/**
 * Login del entrenador (SPEC-033 §3.3). El panel es SOLO para `role = 'trainer'`
 * — un cliente que probara el mismo widget no entra, sin dar más detalle que
 * "esta cuenta no tiene acceso al panel": no hay nada sensible que ocultar
 * aquí (a diferencia de SPEC-035, no es un secreto lo que se protege).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  if (!isWidgetPayload(body)) {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }

  const validSignature = verifyTelegramWidget(body, requireEnv("TELEGRAM_BOT_TOKEN"));
  if (!validSignature) {
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  const db = createDb();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, role, full_name")
    .eq("telegram_user_id", body.id)
    .maybeSingle();

  if (error !== null) {
    return NextResponse.json({ error: "no se pudo verificar la identidad" }, { status: 500 });
  }
  if (profile === null || profile.role !== "trainer") {
    return NextResponse.json({ error: "esta cuenta no tiene acceso al panel" }, { status: 403 });
  }

  const token = await signSessionToken({ profileId: profile.id, role: "trainer" });

  const response = NextResponse.json({ fullName: profile.full_name });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
