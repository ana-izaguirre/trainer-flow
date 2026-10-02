"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle, Link2Off } from "lucide-react";

import type { ClientSummary } from "@core/ports/query-ports.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VERSION_STATE_LABELS, versionStateBadgeVariant } from "@/lib/labels";

/**
 * La animación es la única señal de que la lista recién cargó, no decoración
 * aparte: sin ella, 15 cards aparecen todas a la vez y el ojo no sabe por
 * dónde entrar. `prefers-reduced-motion` ya lo respeta `motion` por defecto.
 */
export function ClientRoster({ clients }: { clients: readonly ClientSummary[] }) {
  if (clients.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Todavía no tenés clientes en tu cartera.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {clients.map((client, index) => (
        <motion.li
          key={client.clientId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
        >
          <Link
            href={`/clientes/${client.clientId}`}
            className="focus-visible:ring-ring block rounded-xl outline-none focus-visible:ring-2"
          >
            <Card className="hover:border-ring transition-colors">
              <CardHeader>
                <CardTitle>{client.fullName}</CardTitle>
                {client.versionState !== null ? (
                  <Badge variant={versionStateBadgeVariant(client.versionState)}>
                    {VERSION_STATE_LABELS[client.versionState]}
                    {client.versionNumber !== null ? ` · v${client.versionNumber}` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline">Sin rutina</Badge>
                )}
              </CardHeader>
              {!client.linked || client.pendingCheckinDays !== null ? (
                <CardContent className="flex flex-col gap-1.5">
                  {!client.linked ? (
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Link2Off className="size-3.5" aria-hidden="true" />
                      Todavía no vinculó su Telegram
                    </span>
                  ) : null}
                  {client.pendingCheckinDays !== null ? (
                    <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      Check-in sin responder hace {client.pendingCheckinDays}{" "}
                      {client.pendingCheckinDays === 1 ? "día" : "días"}
                    </span>
                  ) : null}
                </CardContent>
              ) : null}
            </Card>
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}
