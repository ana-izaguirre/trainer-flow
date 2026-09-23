# TrainerFlow — Seguridad

## Secretos

### La regla: un solo sitio

```
Producción →  supabase secrets set NOMBRE=valor
Local      →  supabase/functions/.env     (gitignored, sin plantilla)
```

**Ningún archivo versionado contiene un secreto, ni siquiera vacío.**
`.env.example` no lleva los nombres de las claves a propósito: un hueco
llamado `GEMINI_API_KEY=` es una invitación a pegarla ahí, y de ahí a un
`git add -A` hay un paso.

### Qué secretos necesita el sistema

Los nombres son **exactos**: es lo que `requireEnv()` pide, carácter por
carácter. Un nombre distinto en `supabase secrets set` hace que la función
falle al arrancar diciendo cuál falta.

| Nombre | Uso | Quién lo pone |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | API de Telegram | Tú, desde BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Verifica que el update viene de Telegram | **Tú lo inventas** (ver abajo) |
| `TALLY_SIGNING_SECRET` | Verifica la firma del webhook de Tally | Tú, desde el panel de Tally |
| `GEMINI_API_KEY` | Solo en `_shared/ai/`. **Nunca en `_core`** | Tú, desde Google AI Studio |
| `CHECKIN_CRON_SECRET` | Que solo el cron dispare el check-in semanal | **Tú lo inventas** (igual que el de Telegram) |
| `SUPABASE_URL` | Acceso de las Edge Functions | **Supabase, automático** |
| `SUPABASE_SERVICE_ROLE_KEY` | Igual | **Supabase, automático** |

Los dos últimos **no se configuran**: Supabase los inyecta en toda Edge
Function. Ponerlos a mano no hace daño, pero tampoco hace nada.

### Los dos que te inventas tú

`TELEGRAM_WEBHOOK_SECRET` y `CHECKIN_CRON_SECRET` no salen de ningún panel: los
eliges tú. Los dos protegen lo mismo —que una Edge Function expuesta a internet
solo la llame quien debe— y los dos se comparan en tiempo constante.

El del cron se lo pasas a `schedule_weekly_checkin` al programar el job (ver
`docs/DEPLOY.md`). Sin él, cualquiera podría disparar el check-in en bucle y
llenar de mensajes el Telegram de todos los clientes.

### `TELEGRAM_WEBHOOK_SECRET` no sale de ningún panel

Es el único que no te dan hecho: **lo eliges tú** y luego se lo dices a
Telegram al registrar el webhook. A partir de ahí Telegram lo devuelve en cada
petición, en la cabecera `x-telegram-bot-api-secret-token`, y el código lo
compara en tiempo constante.

```bash
openssl rand -hex 32
```

Tiene que ser **el mismo valor** en los dos sitios: en `supabase secrets set` y
en el `setWebhook`. Si no coinciden, el bot responde `401` a todo.

Telegram solo acepta `A-Z a-z 0-9 _ -`; `openssl rand -hex` cumple.

### Configuración que NO es secreta

El modelo del proveedor y los límites de la ventana de rate limit son
configuración, no secretos. Pero viajan por el mismo mecanismo
(`supabase secrets set`), porque es así como una Edge Function recibe
variables de entorno. **Tampoco van a un `.env` del repositorio.**

| Variable | Qué hace | Si no está |
|---|---|---|
| `AI_MODEL` | Qué modelo se le pide al proveedor | Un alias móvil al último `flash` |
| `AI_MAX_CALLS` | Llamadas por ventana. **`0` apaga la IA sin desplegar** | `20` |
| `AI_WINDOW_MINUTES` | Cuánto dura la ventana | `60` |

`AI_MODEL` se documenta aquí porque el día que un nombre de modelo se retira,
la generación cae entera y esta es la perilla que la levanta **sin desplegar**.
Que el nombre del modelo no sea un secreto es lo que permite que aparezca en
los logs y en `ai_generations.failure_reason`, que es donde se diagnostica.

`TELEGRAM_BOT_USERNAME` tampoco es secreto: es el nombre público del bot.
Es obligatorio porque sin él el enlace de vinculación sale roto (SPEC-014).

### Qué lo hace cumplir

| Capa | Qué |
|---|---|
| `.gitignore` | `.env` y `.env.*` en **cualquier** directorio. Solo `.env.example` se versiona |
| CI | Escanea el historial buscando secretos, y falla si hay un `.env` versionado |
| Revisión | Un secreto en un archivo que va a commitearse es un bloqueante |

---

## Autenticación

**Identidad por Telegram, verificada server-side.** Sin email ni contraseñas.

```
Telegram → POST /telegram-webhook
             ├─ verificar X-Telegram-Bot-Api-Secret-Token
             ├─ si no coincide → 401, no se procesa nada
             └─ update.message.from.id es CONFIABLE
                     ▼
             profiles WHERE telegram_user_id = ...
```

**No hay frontend en V1**, así que no existe ningún `telegram_user_id` enviado
por un cliente. La única fuente es el update verificado.

`profiles` separa `telegram_user_id` (quién eres) de `telegram_chat_id` (dónde
te escribo). Coinciden en chats privados, pero son conceptos distintos.

**Tally** se verifica con HMAC en la cabecera de firma, con comparación de
tiempo constante. Si no coincide: `401` sin tocar la base de datos.

---

## Autorización

Ver **ADR-010**. Dos capas, con honestidad sobre cuál protege hoy:

| Capa | Qué hace | ¿Activa hoy? |
|---|---|---|
| `_core/authorization.ts` | Funciones puras antes de cada operación. Cobertura 100% | ✅ **Es la que protege** |
| RLS deniega-todo | 10 tablas, RLS activo, cero políticas | ✅ Red contra fugas de `anon key` |
| Políticas por rol | Diseñadas abajo | ⏳ Se activan cuando exista un JWT |

> **Por qué RLS no protege hoy.** Todas las operaciones pasan por Edge Functions
> con `service_role`, que tiene `BYPASSRLS`. Unas políticas por rol nunca se
> evaluarían. Escribirlas ahora daría una falsa sensación de seguridad.

### Reglas que hace cumplir `_core/authorization.ts`

1. Un entrenador solo accede a **sus** clientes.
2. Un entrenador solo modifica rutinas de **sus** clientes.
3. Un cliente solo accede a **su** rutina.
4. **Un cliente nunca modifica una rutina.** Solo puede pedir cambios.
5. **Un cliente solo ve versiones en `SENT`.** Nunca un borrador sin aprobar.
6. Cambiar un ID en una petición no da acceso a nada ajeno: la pertenencia se
   verifica contra el `profile_id` resuelto del webhook, no contra el ID recibido.

También en la base de datos: la FK compuesta contra `profiles (id, role)` hace
**imposible** asignar el perfil de un cliente como entrenador.

### Políticas RLS para cuando exista un JWT

| Tabla | `anon` | Trainer | Client | `service_role` |
|---|---|---|---|---|
| `profiles` | ✗ | solo el propio | solo el propio | todo |
| `clients` | ✗ | SELECT/UPDATE donde `trainer_id = self` | SELECT el propio | todo |
| `assessments` | ✗ | SELECT de sus clientes | SELECT los propios | todo |
| `workout_plans` | ✗ | ALL de sus clientes | SELECT el propio | todo |
| `workout_versions` | ✗ | ALL de sus planes | **SELECT solo `state='SENT'`** | todo |
| `change_requests` | ✗ | SELECT/UPDATE de sus planes | **INSERT + SELECT los propios** | todo |
| `checkins` | ✗ | SELECT de sus clientes | SELECT/UPDATE los propios | todo |
| `plan_events` | ✗ | SELECT de sus planes | ✗ | todo |
| `ai_generations` | ✗ | SELECT de sus planes | ✗ | todo |
| `webhook_events` | ✗ | ✗ | ✗ | solo |

Dos renglones son el principio de producto escrito en SQL:
- El cliente **solo ve `SENT`**: nunca un borrador sin aprobar.
- El cliente puede **INSERT en `change_requests`** pero nunca **UPDATE en
  `workout_versions`**.

**Activación:** una Edge Function verifica el HMAC de `initData` de la WebApp y
emite un JWT con un claim `profile_id`. Las políticas lo leen. No se usa
Supabase Auth ni `auth.users`: menos piezas y sin flujo de registro.

---

## Validación de entrada

Todo payload externo se valida con esquema antes de usarse.

| Origen | Qué se valida |
|---|---|
| Tally | Firma, tamaño ≤ 1 MB, campos tipados, longitud de texto libre |
| Telegram | Secreto de cabecera, `chat_id` autorizado, `callback_data` como UUID |
| **IA** | **Ver sección siguiente** |
| Comandos | Longitud, formato, pertenencia de los IDs |

La validación existe en dos capas: código (mensaje claro) y base de datos
(`CHECK`, la garantía real).

---

## Seguridad de la IA

**La respuesta de la IA es un dato no confiable.** Es la regla más importante
de esta sección.

```
AIProvider.generate() → WorkoutDraft { raw: unknown }
                              ↓
                        validateDraft()
                              ↓
                    ┌─────────┴─────────┐
                  ok: true          ok: false
                    ↓                   ↓
                 Workout          fallo de generación
                (persistible)      (nada se guarda)
```

Reglas:

1. **`WorkoutDraft.raw` es `unknown`, nunca `any`.** El compilador obliga a
   validar antes de leer nada.
2. La respuesta se valida **siempre** contra el esquema. Nunca se confía en que
   devolvió JSON correcto.
3. **La IA no ejecuta código.** Es texto que se parsea como datos.
4. **La IA no escribe en la base de datos.** Produce un draft; el código
   valida, y solo entonces persiste.
5. **La IA no cambia estados.** Los estados los mueve la máquina de estados.
6. La IA no tiene acceso a la base de datos ni a herramientas.

**Sobre prompt injection:** el cliente escribe texto libre en el formulario. Si
intenta manipular el prompt, el peor resultado posible es un borrador malo —
que el entrenador revisa antes de aprobar. **La revisión humana obligatoria es
también el control de seguridad frente a prompt injection.**

---

## Datos sensibles

`assessments.limitations_detail` y `change_requests.comment` contienen
información de salud.

- **Nunca se escriben en logs.**
- Nunca en `plan_events.metadata`.
- Se envían a la IA porque el producto lo requiere, y se le comunica al cliente
  en el formulario.
- `link_token` es una credencial: CSPRNG, nunca logueada, nunca en errores.

### Logs

```
✅ { evento: "version.aprobada", requestId, versionId, actor: "trainer" }
❌ { evento: "version.aprobada", limitaciones: "hernia discal L4-L5" }
❌ { token: "abc123...", apiKey: "..." }
```

Cada petición lleva un `request_id`, guardado también en `webhook_events`,
`plan_events` y `ai_generations`. Eso permite cruzar logs con datos y responder
*"¿qué le pasó a la rutina de Carlos?"* con una sola consulta.

---

## Tests de seguridad obligatorios

| # | Caso |
|---|---|
| 1 | Petición sin firma válida → rechazada, cero escrituras |
| 2 | `chat_id` desconocido → ignorado y registrado |
| 3 | Entrenador A no accede a clientes de entrenador B |
| 4 | Cliente A no accede a datos de cliente B |
| 5 | Cliente no puede modificar una versión |
| 6 | Cliente no ve versiones que no estén en `SENT` |
| 7 | Cambiar un ID en la petición no da acceso ajeno |
| 8 | `anon` no lee ninguna tabla |
| 9 | `anon` no ejecuta las funciones atómicas |
| 10 | Datos inválidos rechazados por `CHECK` |
| 11 | Ningún secreto aparece en logs ni en respuestas |

**Los 11 están en `tests/integration/security.test.ts`**, en ese orden, y se
corren con `pnpm test:integration`. Los casos 1 y 2 tienen además su mitad HTTP
en los tests de Deno, donde vive el handler.

> **El caso 5 estaba roto.** `startManual` y `loadTemplate` escribían sobre la
> versión cuyo id venía en el `callback_data` sin comprobar de quién era: un
> cliente podía sobrescribir la rutina de otro. Corregido en SPEC-013.

---

## Backups y recuperación

**Datos críticos:** `profiles`, `clients`, `assessments`, `workout_plans`,
`workout_versions`. El resto se puede reconstruir o perder sin drama.

| Mecanismo | Frecuencia |
|---|---|
| Backups de Supabase | Según el plan contratado |
| `pg_dump` manual a almacenamiento externo | Semanal |

**Recuperación:** `supabase db reset` aplica las migraciones sobre una base
limpia; después se restaura el volcado. Las migraciones son reproducibles, así
que el esquema nunca se pierde: solo los datos.

**No se construye un sistema de backup propio** para el MVP.

---

## Ambientes

| Ambiente | Base de datos | Secretos |
|---|---|---|
| Desarrollo | `supabase start` (local) | `.env.local`, fuera de git |
| Producción | Proyecto de Supabase | `supabase secrets set` |

La configuración está separada del código. Ningún secreto se expone jamás fuera
del servidor.

---

## Pendiente para después de V1

Rotación de secretos · Rate limiting por IP en los webhooks · Alertas de fallos
de autenticación · Retención y borrado de datos (GDPR) · Activación de las
políticas RLS por rol
