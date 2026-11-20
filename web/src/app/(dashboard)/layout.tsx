import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { createDb } from "@/lib/supabase";
import { LogoutButton } from "@/components/logout-button";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  // El middleware ya garantiza que no se llega aquí sin sesión — esto es
  // defensa en profundidad, nunca el único lugar que decide.
  if (session === null) redirect("/login");

  const db = createDb();
  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", session.profileId)
    .single();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <nav aria-label="Principal" className="flex items-center gap-4">
          <Link href="/" className="font-semibold">
            TrainerFlow
          </Link>
          <Link href="/" className="text-muted-foreground text-sm hover:text-foreground">
            Clientes
          </Link>
          <Link href="/senales" className="text-muted-foreground text-sm hover:text-foreground">
            Señales
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {profile?.full_name ?? ""}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
