#!/usr/bin/env bash
#
# Expone las Edge Functions locales en una URL pública y registra el webhook
# de Telegram contra ella.
#
# Sirve para probar el bot ANTES de desplegar. La URL de un Quick Tunnel es
# aleatoria y cambia en cada arranque, así que registrarla a mano sería una
# molestia constante: por eso este script existe.
#
#   ┌─ USA UN BOT DE PRUEBAS ───────────────────────────────────────────────┐
#   │ No el que usa el entrenador con clientes reales.                      │
#   │                                                                       │
#   │ Mientras el túnel esté arriba, TODOS los mensajes de ese bot llegan a │
#   │ tu portátil. Una prueba tuya puede acabar en el chat de un cliente.   │
#   └───────────────────────────────────────────────────────────────────────┘
#
#   pnpm dev:tunnel
#
set -euo pipefail

ENV_FILE="supabase/functions/.env"
LOG="$(mktemp -t trainerflow-tunnel.XXXXXX)"

rojo() { printf '\033[31m%s\033[0m\n' "$1" >&2; }
info() { printf '\033[36m%s\033[0m\n' "$1"; }

# ── Requisitos ─────────────────────────────────────────────────────────────
command -v cloudflared >/dev/null || {
  rojo "Falta cloudflared."
  rojo "  macOS:  brew install cloudflared"
  rojo "  Linux:  https://github.com/cloudflare/cloudflared/releases"
  exit 1
}

[ -f "$ENV_FILE" ] || {
  rojo "No existe $ENV_FILE."
  rojo "Créalo a mano con TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET."
  rojo "Está en .gitignore y NO tiene plantilla, a propósito (docs/SECURITY.md)."
  exit 1
}

# `set -a` exporta lo que se lea. El archivo nunca se imprime: lleva secretos.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for var in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET; do
  [ -n "${!var:-}" ] || { rojo "Falta $var en $ENV_FILE."; exit 1; }
done

# ── Limpieza ───────────────────────────────────────────────────────────────
# Sin esto, Telegram seguiría llamando a un túnel muerto y acumulando errores.
limpiar() {
  info ""
  info "Borrando el webhook…"
  curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook" >/dev/null || true
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$LOG"
  info "Listo."
}
trap limpiar EXIT INT TERM

# ── Túnel ──────────────────────────────────────────────────────────────────
info "Abriendo el túnel…"
cloudflared tunnel --url http://localhost:54321 >"$LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { rojo "cloudflared murió:"; cat "$LOG" >&2; exit 1; }
  sleep 1
done

[ -n "$URL" ] || { rojo "El túnel no dio URL en 30s:"; cat "$LOG" >&2; exit 1; }

# ── Webhook ────────────────────────────────────────────────────────────────
WEBHOOK_URL="${URL}/functions/v1/telegram-webhook"
info "Registrando  →  ${WEBHOOK_URL}"

# El token va en la URL y el secreto en el cuerpo: ninguno se imprime.
RESPUESTA=$(curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${WEBHOOK_URL}" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "drop_pending_updates=true")

case "$RESPUESTA" in
  *'"ok":true'*) info "Webhook registrado." ;;
  # La respuesta de error de Telegram no incluye el token ni el secreto.
  *) rojo "Telegram rechazó el registro:"; rojo "$RESPUESTA"; exit 1 ;;
esac

cat <<EOF

  ✅  Tu bot apunta a esta máquina.

      En otra terminal:
        supabase functions serve telegram-webhook --env-file $ENV_FILE

      Escríbele a tu bot de PRUEBAS y mira los logs de esa terminal.

      Ctrl-C aquí cierra el túnel y borra el webhook.

EOF

wait "$TUNNEL_PID"
