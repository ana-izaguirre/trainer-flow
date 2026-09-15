# TrainerFlow — Seguridad

## Secretos

Nunca en git. Se gestionan con `supabase secrets set`.

| Secreto | Uso |
|---|---|
| `GEMINI_API_KEY` | Llamadas a Gemini |
| `TELEGRAM_BOT_TOKEN` | API de Telegram |
| `TELEGRAM_TRAINER_CHAT_ID` | Chat del entrenador |
| `TELEGRAM_WEBHOOK_SECRET` | Verificación de webhooks de Telegram |
| `TALLY_WEBHOOK_SECRET` | Verificación de firma de Tally |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso de las Edge Functions |

`.env` y `.env.local` van en `.gitignore`. Se versiona un `.env.example`
solo con nombres, nunca con valores.

## Verificación de webhooks

**Ningún webhook confía en su entrada.** Ambos orígenes se verifican antes
de tocar la base de datos.

**Tally** — firma HMAC en la cabecera `tally-signature`. Se compara con
comparación de tiempo constante. Si no coincide: `401` y no se procesa.

**Telegram** — cabecera `X-Telegram-Bot-Api-Secret-Token` contra
`TELEGRAM_WEBHOOK_SECRET`, configurado al registrar el webhook.
Si no coincide: `401`.

Adicionalmente, todo `callback_query` y comando de Telegram verifica que el
`chat_id` que lo envía es el del entrenador o el de un cliente registrado.
**Un desconocido que encuentre el bot no puede aprobar rutinas.**

## Validación de entrada

Todo payload externo se valida con un esquema antes de usarse.
El `raw_payload` se guarda íntegro, pero los campos tipados se validan:

- `days_per_week` entre 1 y 7 — constraint en base de datos, no solo en código.
- `session_minutes` entre 15 y 180.
- `level` dentro del conjunto permitido.
- Longitud máxima en todos los campos de texto libre.

La validación existe en dos capas: código (mensaje claro) y base de datos
(garantía real).

## Autorización

| Actor | Puede |
|---|---|
| Entrenador | Ver todos sus clientes, aprobar, rechazar, editar |
| Cliente | Ver únicamente su propia rutina y sus check-ins |
| Anónimo | Nada |

**Row Level Security activo en todas las tablas.** Las Edge Functions usan
`service_role` y saltan RLS por diseño, así que la autorización real vive en
el código de las funciones. RLS es la red de seguridad frente a fugas de la
`anon key`.

## Protección de datos sensibles

`limitations_detail` contiene información de salud. Reglas:

- **Nunca se escribe en logs.**
- Nunca se incluye en `plan_events.metadata`.
- Se envía a Gemini porque es necesario para el producto, y eso se le
  comunica al cliente en el formulario.
- `link_token` es una credencial: se genera con CSPRNG, nunca se loguea,
  nunca aparece en mensajes de error.

## Logs

Formato estructurado. Se registra qué pasó y con qué entidad, nunca el
contenido sensible.

```
✅ { evento: "plan.aprobado", planId: "...", clientId: "...", actor: "trainer" }
❌ { evento: "plan.aprobado", limitaciones: "hernia discal L4-L5" }
❌ { token: "abc123...", apiKey: "..." }
```

## Guardrails de IA

Gemini recibe datos del cliente, que son entrada no confiable. Reglas:

- La respuesta de Gemini **siempre se valida contra un esquema** antes de
  guardarse. Nunca se confía en que devolvió JSON correcto.
- Gemini no tiene acceso a la base de datos ni a herramientas.
- Ninguna respuesta de Gemini puede cambiar un estado. Los estados los cambia
  la máquina de estados, invocada por el código.
- Si el cliente escribe instrucciones en el campo de texto libre intentando
  manipular el prompt, el peor resultado posible es un borrador malo — que
  el entrenador revisa antes de aprobar. **El humano en el loop es también
  el control de seguridad frente a prompt injection.**

## Pendiente para después de V1

Rotación de secretos · Rate limiting por IP en los webhooks ·
Alertas de fallos de autenticación · Retención y borrado de datos (GDPR)
