# SPEC-011 — Tests de la capa Deno y smoke test de arranque

| Campo | Valor |
|---|---|
| **Estado** | **APROBADA** — pendiente de implementar |
| **Depende de** | SPEC-003, SPEC-009 |
| **Sesiones** | S-29 (nueva) |

## 1. Objetivo

Cerrar el único hueco de verificación que queda: **`_shared/` y los handlers
HTTP no tienen ni un test.**

La lógica está al 100%. Lo que nadie comprueba es que esté **bien cableada**:
que el nombre de una variable de entorno sea el correcto, que el header sea
el correcto, que las dependencias se construyan en el orden correcto.

> Un `TELEGRAM_BOT_TOKEN` mal escrito compila, pasa los 491 tests, pasa las
> cuatro verificaciones, y revienta con el primer mensaje real.

## 2. El hallazgo que motiva la spec

`_shared/env.ts` documenta su propio contrato:

```typescript
/** Falla al arrancar si falta algo, en vez de fallar a mitad de una petición. */
export function requireEnv(name: string): string
```

Pero `telegram-webhook/index.ts` lo llama **dentro** del handler:

```typescript
Deno.serve(async (request: Request): Promise<Response> => {
  ...
  const telegram = createTelegramClient(requireEnv('TELEGRAM_BOT_TOKEN'), log);
```

**Consecuencia real.** Con un secreto mal escrito la función despliega bien,
responde al health check, y falla en la primera petición de verdad. Telegram
reintenta, vuelve a fallar, y el entrenador no se entera: solo ve que el bot
«no contesta».

Es exactamente el fallo que un smoke test existe para atrapar, así que la
spec lo arregla además de probarlo.

## 3. Alcance

**Incluye:** tests de `_shared/` con `deno test`, refactor mínimo del handler
para hacerlo invocable sin servidor, smoke test en CI, y el comando
`pnpm deno:test`.

**No incluye:** tests contra un Supabase real (eso es S-28), ni cobertura del
100% en `_shared` — ver sección 6.

## 4. Decisión: dos runners, uno por runtime

No es una preferencia, es una consecuencia del ADR-001.

| Capa | Runtime | Runner | Por qué |
|---|---|---|---|
| `_core/` | ambos | **Vitest (Node)** | TS puro, sin I/O |
| `_shared/` | Deno | **`deno test`** | Usa `Deno.env`, `fetch` e imports `npm:` |
| handlers | Deno | **`deno test`** | Igual |

`_shared` **no se puede probar desde Node**: `tsconfig.json` ya lo excluye
a propósito, porque `tsc` no resuelve `Deno.env` ni `npm:`. Intentarlo sería
pelearse con la premisa del proyecto.

El CI ya tiene Deno instalado (`deno:check`, `deno:lint`), así que añadir
`deno test` cuesta una línea.

## 5. Contratos

### El handler se vuelve invocable

```typescript
// telegram-webhook/index.ts
export interface HandlerDeps {
  readonly repo: TelegramRepo;
  readonly sender: TelegramSender;
  readonly expectedSecret: string;
}

/** Construye las dependencias LEYENDO EL ENTORNO. Falla si falta algo. */
export function buildDeps(): HandlerDeps;

/** El handler puro: recibe dependencias, devuelve Response. */
export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response>;

// Al arrancar: si falta un secreto, esto revienta AQUÍ, no en la primera
// petición. Es el contrato que env.ts ya decía tener.
Deno.serve(createHandler(buildDeps()));
```

Con eso, un test construye un `Request`, pasa dependencias falsas, y
comprueba la `Response` **sin Docker, sin red y sin Supabase**.

## 6. Reglas

1. **`_shared` no lleva umbral del 100%.** Es I/O: parte de su código solo
   se ejecuta cuando la red falla de una forma concreta. Perseguir el 100%
   ahí produce tests que simulan el mundo en vez de probar el código. El
   umbral obligatorio sigue siendo el de `_core` (CLAUDE.md).
2. **Ningún test de `_shared` toca la red de verdad.** `fetch` se sustituye.
   Un test que llama a `api.telegram.org` es un test que falla los lunes.
3. **Ningún test lleva un token real**, ni siquiera uno caducado. Los valores
   son obviamente falsos (`token-de-prueba`).
4. **El smoke test no necesita Docker.** Si lo necesitara, no correría en
   cada push, y un smoke test que no corre siempre no sirve de nada.
5. `buildDeps()` se llama una vez al arrancar. Si falta un secreto, el
   despliegue falla ruidosamente.

## 7. Qué se prueba en cada módulo

| Módulo | Casos |
|---|---|
| `env.ts` | Presente · ausente → lanza · cadena vacía → lanza · `optionalEnv` → `null` |
| `logger.ts` | Forma estructurada · el nivel correcto · **nunca imprime un secreto** |
| `telegram/client.ts` | URL y cuerpo correctos · **el token nunca entra al log** · trunca a 4096 · `response.ok === false` → `null` · fallo de red → `null`, no excepción · `message_id` ausente o de tipo raro → `null` |
| `db.ts` | **Contra PostgREST real** (ver §7.1). `claimWebhookEvent`: sin error → `true` · `23505` → `false` · otro error → lanza · `findIdentity` resuelve y devuelve `null` si no existe |
| `telegram-webhook/index.ts` | Secreto incorrecto → **401** · cuerpo ilegible → no lanza · `buildDeps()` sin entorno → lanza nombrando la variable |

### 7.1 · `db.ts` necesita PostgREST, no Postgres

`db.ts` no ejecuta SQL: llama a la API REST.

```typescript
db.from('webhook_events').insert({ ... })   // ← PostgREST, no SQL
```

Por eso los 56 tests de integración actuales **no lo prueban**: usan el driver
`pg` con SQL crudo y verifican el *esquema*. `db.ts` no lo toca nadie.

Sustituir `supabase-js` con un doble sería probar el doble. La alternativa
honesta es levantar PostgREST, que son **dos contenedores**, no los diez de
un Supabase completo:

```yaml
services:
  postgres:
    image: postgres:16-alpine
  postgrest:
    image: postgrest/postgrest:v12
    env:
      PGRST_DB_URI: postgresql://postgres:postgres@postgres:5432/postgres
      PGRST_DB_SCHEMAS: public
      PGRST_JWT_SECRET: <cadena de prueba, no es un secreto>
```

**Qué NO hace falta levantar:** Auth, Storage, Realtime, Studio, Inbucket,
imgproxy. El proyecto no usa ninguno — `config.toml` ya tiene `auth` y
`analytics` en `false`.

### 7.2 · Dos niveles de Docker, y por qué no son el mismo

| | Nivel A — CI | Nivel B — S-28 |
|---|---|---|
| Qué levanta | Postgres + PostgREST | `supabase start` (todo) |
| Cuándo | **Cada push** | A mano, antes de desplegar |
| Cuánto tarda | segundos | minutos |
| Qué prueba | `db.ts` de verdad | El stack completo |
| Necesita el registro de imágenes | no (imágenes públicas) | **sí** |

El nivel B no puede correr en cada push: es lento, y depende del registro de
imágenes de Supabase, que ya nos dio un 403 una vez. Un smoke test que a
veces no corre no es un smoke test.

**El nivel A es el que cambia las cosas**, y cuesta doce líneas de YAML.

## 8. Errores

| Situación | Respuesta |
|---|---|
| Falta un secreto al arrancar | La función no arranca. El error nombra la variable |
| Telegram devuelve 5xx | `null`, se loguea `method` y status. **Nunca el token** |
| La red falla | `null`, se loguea. No sube la excepción al handler |
| Cuerpo JSON ilegible | Se trata como malformado, no como excepción |

## 9. Seguridad

- Ningún test contiene un token real, caducado o no.
- Un test **verifica** que el token del bot no aparece en ninguna línea de
  log, capturando la salida del logger. Hoy eso solo lo garantiza un
  comentario.
- El escáner de secretos del CI cubre también estos archivos nuevos.

## 10. Criterios de aceptación

- **CA-1** — DADO el entorno sin `TELEGRAM_BOT_TOKEN`, CUANDO se llama a
  `buildDeps()`, ENTONCES lanza un error que **nombra la variable**.
- **CA-2** — DADO un handler con dependencias falsas, CUANDO llega una
  petición con el secreto incorrecto, ENTONCES responde **401** sin tocar
  el repo.
- **CA-3** — DADO un cuerpo que no es JSON, CUANDO llega, ENTONCES responde
  sin lanzar excepción.
- **CA-4** — DADO un `fetch` sustituido que devuelve 500, CUANDO se envía un
  mensaje, ENTONCES `sendMessage` devuelve `null` y **el token no aparece en
  ninguna línea de log**.
- **CA-5** — DADO un `fetch` que rechaza, CUANDO se envía un mensaje,
  ENTONCES devuelve `null` en vez de propagar la excepción.
- **CA-6** — DADO un texto de 5000 caracteres, CUANDO se envía, ENTONCES el
  cuerpo de la petición lleva 4096.
- **CA-7** — DADO **PostgREST levantado sobre el esquema real**, CUANDO se
  llama dos veces a `claimWebhookEvent` con el mismo `external_id`, ENTONCES
  la primera devuelve `true` y la segunda `false`. Sin dobles: la idempotencia
  se verifica contra el `UNIQUE` de verdad.
- **CA-8** — DADO el CI, CUANDO corre, ENTONCES `pnpm deno:test` es una
  verificación más y **no necesita Docker**.

## 11. La quinta verificación

```bash
pnpm typecheck      # tsc sobre _core + tests
pnpm lint           # oxlint
pnpm deno:check     # compila en Deno
pnpm deno:lint      # lint de Deno
pnpm deno:test      # ◄── NUEVO: _shared y handlers
```

## 12. Fuera de alcance: el smoke test contra Supabase real

```bash
supabase functions serve telegram-webhook --env-file supabase/functions/.env
curl -i -X POST http://localhost:54321/functions/v1/telegram-webhook \
  -H 'x-telegram-bot-api-secret-token: incorrecto' -d '{}'
```

Esto es valioso y hay que hacerlo, pero **necesita Docker y un proyecto
enlazado**, así que es S-28, no esta spec. Queda documentado en `DEPLOY.md`
como paso manual de despliegue.

## 13. Archivos

```
supabase/functions/_shared/env.test.ts                 nuevo
supabase/functions/_shared/logger.test.ts              nuevo
supabase/functions/_shared/telegram/client.test.ts     nuevo
supabase/functions/_shared/db.test.ts                  nuevo
docker-compose.test.yml                                nuevo (Postgres + PostgREST)
supabase/functions/telegram-webhook/index.ts           refactor
supabase/functions/telegram-webhook/index.test.ts      nuevo
supabase/functions/deno.json                           incluir *.test.ts
package.json                                           deno:test
.github/workflows/ci.yml                               un paso más
docs/TESTING.md                                        la pirámide gana una capa
docs/ROADMAP.md                                        S-29
```
