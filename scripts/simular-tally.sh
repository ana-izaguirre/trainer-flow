#!/usr/bin/env bash
#
# Dispara una evaluación de Tally FIRMADA contra la función desplegada, sin
# tocar el formulario. Sirve para probar el ciclo completo cuando Tally
# todavía no está conectado, o para repetirlo sin ensuciar el formulario real.
#
#   TALLY_SIGNING_SECRET=… SUPABASE_PROJECT_REF=… ./scripts/simular-tally.sh "Carlos Prueba"
#
# Los secretos entran por el entorno. Nada de esto se escribe en el archivo ni
# queda en la URL: la firma viaja en una cabecera.
set -euo pipefail

: "${TALLY_SIGNING_SECRET:?Falta TALLY_SIGNING_SECRET (el del panel de Tally)}"
: "${SUPABASE_PROJECT_REF:?Falta SUPABASE_PROJECT_REF}"

NOMBRE="${1:-Cliente de prueba}"
FIXTURE="$(dirname "$0")/../tests/fixtures/tally-form-response.json"
URL="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/tally-webhook"

# ── Un eventId nuevo en cada disparo ────────────────────────────────────────
# `claimEvent` usa `eventId` como clave de idempotencia. Sin esto, el segundo
# intento responde `duplicate` y no crea nada — que es correcto, pero no es lo
# que quieres mientras pruebas.
EVENT_ID="$(uuidgen 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')"

CUERPO="$(python3 - "$FIXTURE" "$EVENT_ID" "$NOMBRE" <<'PY'
import json, sys
ruta, event_id, nombre = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(ruta, encoding='utf-8'))

d['eventId'] = event_id
d['data']['responseId'] = event_id[:8]
d['data']['submissionId'] = event_id[:8]

# El campo del nombre es el primer INPUT_TEXT etiquetado "Nombre".
for f in d['data']['fields']:
    if f.get('label', '').strip().lower() == 'nombre':
        f['value'] = nombre
        break

# Las URLs del fixture llevan un accessToken redactado. Fuera: no hacen falta
# para el flujo y no conviene mandar cadenas que parezcan credenciales.
d['data'].pop('submissionPdfUrl', None)
d['data'].pop('submissionPreviewUrl', None)

# Sin espacios: la firma se calcula sobre ESTOS bytes exactos.
sys.stdout.write(json.dumps(d, separators=(',', ':'), ensure_ascii=False))
PY
)"

FIRMA="$(printf '%s' "$CUERPO" \
  | openssl dgst -sha256 -hmac "$TALLY_SIGNING_SECRET" -hex \
  | sed 's/^.*= //')"

echo "→ POST  $URL"
echo "  eventId: $EVENT_ID"
echo "  nombre:  $NOMBRE"
echo

CODIGO="$(printf '%s' "$CUERPO" | curl -sS -o /tmp/tally-respuesta.txt -w '%{http_code}' \
  -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "tally-signature: ${FIRMA}" \
  --data-binary @-)"

echo "← HTTP $CODIGO — $(cat /tmp/tally-respuesta.txt)"
echo

case "$CODIGO" in
  200) echo "✅ Entró. Mira Telegram: te tiene que llegar el aviso con el enlace del cliente." ;;
  401) echo "❌ Firma rechazada. TALLY_SIGNING_SECRET no coincide con el del panel de Tally." ;;
  500) echo "❌ Falló dentro. Edge Functions → tally-webhook → Logs."
       echo "   Lo más común: todavía no existe tu perfil de entrenador (paso 9 del DEPLOY)." ;;
  *)   echo "❓ Revisa los logs de tally-webhook." ;;
esac
