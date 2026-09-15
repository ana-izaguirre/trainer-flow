# SPEC-003 — Revisión de la rutina en Telegram

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-008, SPEC-009 |
| **Sesiones** | S-09 |

## 1. Objetivo

El entrenador recibe el borrador en Telegram, formateado y legible, con
botones para editar, aprobar o rechazar.

## 2. Alcance

**Incluye:** bot y webhook de Telegram, formateo del mensaje, teclado inline,
aviso cuando la IA falla, idempotencia de `update_id`.

**No incluye:** la lógica de los botones (SPEC-004), comandos (SPEC-007).

## 3. Contratos

### Salida hacia el entrenador

```
🏋️ Nueva rutina para Carlos

Objetivo: Ganancia muscular
Nivel: Intermedio
Días: 4 · 60 min
Equipamiento: Gimnasio

━━━ Día 1 — Empuje ━━━
• Press banca — 4x8 (90s)
• Press militar — 3x10 (60s)

⚠️ Limitación: hombro
   Se evitó press tras nuca.

[✏️ Editar] [✅ Aprobar] [❌ Rechazar]
```

`callback_data`: `act:<accion>:<versionId>` — máximo 64 bytes (límite de Telegram).

### Entrada

`POST /functions/v1/telegram-webhook` — objeto `Update` de Telegram.

## 4. Reglas de negocio

1. Se verifica `X-Telegram-Bot-Api-Secret-Token`. Si no coincide: `401`.
2. **Idempotencia:** `webhook_events (source='telegram', external_id=update_id)`.
3. **Solo se envía al `telegram_chat_id` del entrenador.** Nunca a otro chat.
4. Telegram limita los mensajes a 4096 caracteres. Una rutina más larga se
   divide en varios mensajes; los botones van en el último.
5. Los caracteres especiales de MarkdownV2 se escapan. El nombre del cliente
   es texto no confiable.
6. Si la IA falló (la versión volvió a `NEW`), se envía un aviso **sin botones
   de aprobación**, ofreciendo plantilla o creación manual.
7. El `message_id` enviado se guarda para poder retirar los botones después.
8. El envío con botones solo ocurre si la versión está en `DRAFT`.

## 5. Estados

No cambia estados. Notifica sobre `DRAFT`, y avisa cuando la IA falla y la
versión vuelve a `NEW`.

## 6. Errores

| Situación | Efecto |
|---|---|
| Telegram devuelve `429` | Reintento con backoff, máximo 3 |
| El entrenador bloqueó el bot | Se registra; la versión sigue en `DRAFT` |
| Mensaje > 4096 caracteres | Se divide automáticamente |
| Secreto inválido | `401`, sin procesar |
| `update_id` duplicado | `200`, sin efecto |

## 7. Seguridad

- **Todo `chat_id` entrante se valida** contra el entrenador o un cliente
  registrado. Un desconocido no puede interactuar con el bot.
- El token del bot nunca se loguea.
- `limitations_detail` sí se muestra al entrenador (lo necesita), pero no se
  loguea.

## 8. Criterios de aceptación

- **CA-1** — DADO una versión en `DRAFT`, CUANDO se notifica, ENTONCES
  el entrenador recibe el mensaje con los tres botones.
- **CA-2** — DADO un plan de 7 días que excede 4096 caracteres, CUANDO se
  envía, ENTONCES llega dividido y los botones van en el último mensaje.
- **CA-3** — DADO un cliente llamado `Ana_*[test]`, CUANDO se formatea,
  ENTONCES el mensaje no rompe el parseo de MarkdownV2.
- **CA-4** — DADO que la IA falló y la versión volvió a `NEW`, CUANDO se
  notifica, ENTONCES el aviso
  **no** incluye el botón de aprobar.
- **CA-5** — DADO un `update` de un `chat_id` desconocido, CUANDO llega,
  ENTONCES se ignora y se registra el intento.
- **CA-6** — DADO un `update_id` ya procesado, CUANDO se reenvía, ENTONCES no
  hay ningún efecto.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `formatPlanMessage` con rutina de 3 y de 7 días |
| Unit | Escapado de MarkdownV2 con caracteres especiales |
| Unit | `splitMessage` respeta el límite de 4096 |
| Unit | `buildCallbackData` no supera 64 bytes |
| Unit | `isAuthorizedChat` acepta entrenador y cliente, rechaza desconocido |
| Integration | CA-1, CA-5, CA-6 con la API de Telegram mockeada |
| E2E | Paso 4 del camino crítico |

## 10. Archivos que toca

```
supabase/functions/_core/telegram-format.ts
supabase/functions/_core/telegram-format.test.ts
supabase/functions/_core/authorization.ts
supabase/functions/_shared/telegram.ts
supabase/functions/telegram-webhook/index.ts
```
