import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/jwt";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
