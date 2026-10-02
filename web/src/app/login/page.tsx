"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [widgetState, setWidgetState] = useState<"loading" | "ready" | "failed">("loading");
  const widgetContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      setStatus("loading");
      setErrorMessage("");
      try {
        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setErrorMessage(body?.error ?? "No se pudo iniciar sesión.");
          setStatus("error");
          return;
        }
        router.replace(searchParams.get("next") ?? "/");
      } catch {
        setErrorMessage("No se pudo contactar al servidor.");
        setStatus("error");
      }
    };
    return () => {
      window.onTelegramAuth = undefined;
    };
  }, [router, searchParams]);

  // El widget de Telegram se auto-inserta reemplazando su propio <script> por
  // un iframe — por eso se crea a mano, apuntado a este contenedor, en vez de
  // dejarlo a next/script: ese gestiona la posición de inserción y rompería
  // el lugar exacto donde Telegram espera insertarse.
  useEffect(() => {
    if (BOT_USERNAME === "" || widgetContainerRef.current === null) return;

    // Sin esto, una red lenta o un bloqueo (proxy corporativo, ad-blocker)
    // deja al entrenador mirando una página en blanco sin ninguna pista.
    const failTimeout = setTimeout(() => setWidgetState("failed"), 8000);

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.onload = () => {
      clearTimeout(failTimeout);
      setWidgetState("ready");
    };
    script.onerror = () => {
      clearTimeout(failTimeout);
      setWidgetState("failed");
    };

    widgetContainerRef.current.appendChild(script);

    return () => clearTimeout(failTimeout);
  }, []);

  return (
    <>
      {status === "loading" ? (
        <Button disabled variant="outline" size="lg">
          <Loader2 className="animate-spin" aria-hidden="true" />
          Entrando…
        </Button>
      ) : BOT_USERNAME === "" ? (
        <p role="alert" className="text-destructive text-sm">
          Falta configurar NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.
        </p>
      ) : (
        <>
          {widgetState === "loading" ? (
            <Loader2 className="text-muted-foreground animate-spin" aria-hidden="true" />
          ) : null}
          {widgetState === "failed" ? (
            <p role="alert" className="text-destructive max-w-xs text-sm">
              El botón de Telegram no cargó. Revisá tu conexión y recargá la página.
            </p>
          ) : null}
          <div ref={widgetContainerRef} aria-label="Ingresar con Telegram" />
        </>
      )}

      {status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">TrainerFlow</h1>
        <p className="text-muted-foreground text-sm">
          Entrá con la misma cuenta de Telegram que ya usás con el bot.
        </p>
      </div>

      <Suspense fallback={<Loader2 className="animate-spin" aria-hidden="true" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
