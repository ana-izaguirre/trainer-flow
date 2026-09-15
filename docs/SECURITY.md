# TrainerFlow — Seguridad

## Secretos

Nunca van a git. Se gestionan con `supabase secrets set`.

| Secreto | Uso |
|---|---|
| `GEMINI_API_KEY` | Solo en `_shared/ai/gemini-provider.ts`. Nunca en `_core` |
| `TELEGRAM_BOT_TOKEN` | API de Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | Verificación de updates entrantes |
| `TALLY_WEBHOOK_SECRET` | Verificación de firma de Tally |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso de las Edge Functions |

`.env*` en `.gitignore`. Se versiona solo `.env.example`, con nombres y sin valores.

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

Los casos 8, 9 y 10 ya están cubiertos en `tests/integration/schema.test.ts`.

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
