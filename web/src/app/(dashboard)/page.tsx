import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { createDb } from "@/lib/supabase";
import { createQueryRepo } from "@/lib/query-repo";
import { ClientRoster } from "@/components/client-roster";

export const metadata = { title: "Clientes — TrainerFlow" };

export default async function ClientesPage() {
  const session = await getSession();
  if (session === null) redirect("/login");

  const repo = createQueryRepo(createDb());
  const clients = await repo.clients(session.profileId);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Tu cartera</h1>
      <ClientRoster clients={clients} />
    </div>
  );
}
