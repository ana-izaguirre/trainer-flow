"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Cerrar sesión">
      <LogOut aria-hidden="true" />
      <span className="hidden sm:inline">Salir</span>
    </Button>
  );
}
