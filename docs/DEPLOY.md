# TrainerFlow — CI, despliegue y desarrollo local

Tres cosas distintas que conviene no mezclar:

| | Qué es | Estado |
|---|---|---|
| **CI** | Que nada roto llegue a `main` | ✅ Activo |
| **CD** | Desplegar a Supabase | ⏳ S-28 |
| **Local** | Ver los cambios funcionando | 📋 Documentado abajo |

---

## CI — `.github/workflows/ci.yml`

Corre en **cada push** y en cada PR hacia `main`.

| Paso | Qué comprueba |
|---|---|
| `pnpm typecheck` | TypeScript estricto en `_core` y los tests (Node) |
| `pnpm lint` | oxlint, incluido el aislamiento de `_core` (ADR-001) |
| `pnpm deno:check` | **El mismo `_core` compila también en Deno**, más `_shared` y los handlers |
| `pnpm deno:lint` | El linter de Deno, que conoce idioms que oxlint no |
| `pnpm test:coverage` | 155 tests unitarios + **los umbrales del 100%** |
| `pnpm test:integration` | 45 tests contra PostgreSQL real |
| Escáner de secretos | Ningún secreto en el historial, ningún `.env` versionado |

### Por qué los tests de integración no necesitan Supabase

Corren contra un contenedor de **PostgreSQL pelado**, porque
`tests/sql/00-supabase-roles.sql` reproduce los roles (`anon`,
`authenticated`, `service_role`) que un proyecto de Supabase trae de fábrica.

Eso hace el CI mucho más simple y rápido: un `services.postgres` y listo, sin
levantar el stack de Supabase.

### Cobertura en el PR

`davelosert/vitest-coverage-report-action` comenta la tabla de cobertura en
cada PR, con enlaces a los archivos y las líneas sin cubrir.

Corre con `if: always()`, así que el comentario aparece **también cuando un
umbral falla** — que es justo cuando más falta hace verlo.

Requiere `pull-requests: write` en los permisos del job, y los reporters
`json-summary` y `json` en `vitest.config.ts`.

### Los umbrales que rompen el CI

Tres módulos exigen **100%** en statements, branches, functions y lines:

| Módulo | Por qué |
|---|---|
| `authorization.ts` | Con RLS en denegación total, es lo único que separa a un cliente de los datos de otro |
| `state-machine.ts` | Hace imposible que una rutina llegue al cliente sin aprobación |
| `validate-draft.ts` | La frontera con la IA: nada entra al dominio sin pasar por aquí |

Si la cobertura de cualquiera baja del 100%, **el CI se pone rojo**.

---

## CD — despliegue a Supabase *(pendiente, S-28)*

```bash
supabase db push            # aplica las migraciones
supabase functions deploy   # sube las Edge Functions
```

Necesita dos secretos en GitHub: `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PROJECT_ID`.

> ⚠️ **`supabase db push` sobre producción aplica migraciones sin vuelta atrás.**
> El workflow de despliegue debe depender del de CI y disparar **solo** desde
> `main`, nunca desde una rama.

**Sobre entornos de preview por PR:** Supabase tiene *branching*, pero es una
funcionalidad **de pago**. En el plan gratuito hay un solo proyecto.

---

## Desarrollo local — ver los cambios funcionando

| Qué quieres ver | Cómo | Necesita |
|---|---|---|
| Lógica de `_core` | `pnpm test` | nada |
| Esquema y constraints | `pnpm test:integration` | PostgreSQL |
| Una Edge Function | `supabase functions serve <nombre>` | Docker |
| **Un webhook real** | ⚠️ **un túnel** | ver abajo |

### Qué cubre cada capa de tests

| Capa | Cubre | No cubre |
|---|---|---|
| Unit (`_core`) | Dominio, y **el flujo del webhook con sus pasos en orden** | Nada externo |
| Integración | Esquema, constraints, RLS, funciones SQL | HTTP |
| **E2E-1** | El camino manual completo contra PostgreSQL real | HTTP y Telegram |
| *Pendiente (S-28)* | PostgREST y Telegram respondiendo de verdad | — |

El flujo del webhook se prueba **sin levantar nada** porque devuelve un
`WebhookOutcome` en vez de una `Response` (ADR-011). Lo único sin cubrir es que
los servicios externos contesten, y eso necesita Docker.

### El problema del webhook

Telegram y Tally necesitan una **URL pública** para entregarte el evento. Tu
máquina no la tiene.

**Pero no los necesitas por igual:**

| Origen | ¿Hace falta túnel? |
|---|---|
| **Tally** | ❌ No. SPEC-001 ya guarda un payload real en `tests/fixtures/`. Se reenvía con `curl` |
| **Telegram** | ✅ Sí. Los botones y comandos solo llegan por webhook |

Así que el túnel es un problema de **una sola integración**.

---

## Cloudflare Tunnel — evaluación

### Las dos formas

| | Quick Tunnel | Named Tunnel |
|---|---|---|
| Comando | `cloudflared tunnel --url http://localhost:54321` | Requiere `login` + `route dns` |
| Cuenta de Cloudflare | ❌ No hace falta | ✅ Sí |
| Dominio propio | ❌ No | ✅ Sí (≈ $10/año) |
| URL | Aleatoria en `*.trycloudflare.com` | Estable, tuya |
| **Cambia al reiniciar** | ✅ Sí | ❌ No |
| Setup | **2 minutos** | ~20 minutos |
| Costo | $0 | Solo el dominio |

### Veredicto: **viable, y de complejidad baja**

**Ventajas sobre ngrok:** sin límite de ancho de banda, los túneles no expiran,
y las conexiones son **solo salientes** — tu máquina nunca acepta tráfico
entrante directo. Eso último importa cuando expones tu portátil a internet.

**La única fricción real del Quick Tunnel** es que la URL cambia en cada
arranque, así que hay que volver a registrar el webhook de Telegram. Pero eso
**es una llamada a la API**, no un paso manual:

```bash
pnpm dev:tunnel
```

`scripts/dev-tunnel.sh` abre el túnel, saca la URL del log, y registra el
webhook contra ella. **Al salir con Ctrl-C borra el webhook**: si no, Telegram
seguiría llamando a un túnel muerto y acumulando errores.

Lee los dos secretos de `supabase/functions/.env`, que está en `.gitignore`.
Si falta el archivo o una variable, lo dice por su nombre y no arranca.

Un script, dos comandos. **La fricción desaparece.**

### Recomendación

| Cuándo | Qué |
|---|---|
| Al crear el bot | `pnpm dev:tunnel` + **un bot de pruebas aparte del real** |
| Si la URL cambiante molesta | Named Tunnel con un dominio propio |
| Producción | Nada de esto: las Edge Functions ya tienen URL pública |

**Lo importante no es el túnel, es el bot de pruebas.** Un bot separado del
que usa tu esposo evita que una prueba tuya le llegue a un cliente real.

---

## Despliegue automático

`\.github/workflows/deploy.yml` publica lo que hay en `main`, y **solo si el
CI quedó en verde**.

```
PR  →  CI verde  →  merge a main  →  CI en main  →  Deploy
```

### Las dos puertas

| Puerta | Qué exige | Dónde se activa |
|---|---|---|
| **1 · Pull request** | Que nada llegue a `main` sin PR y sin CI verde | Settings → Branches → *Require a pull request* + *Require status checks* |
| **2 · Aprobación manual** | Un clic tuyo antes de publicar | Settings → Environments → `production` → *Required reviewers* |

La segunda es opcional: mientras no se configure, no bloquea. El workflow ya
declara `environment: production`, así que activarla es solo marcar la casilla.

**Sin la primera, un `git push` directo a main se publica solo.** Es la que de
verdad importa.

### Cuándo NO despliega

Si el commit no tocó nada bajo `supabase/`, se salta todo y lo dice en el
resumen del run. Un cambio en un `.md` no tiene nada que desplegar, y
`functions deploy` crearía una versión nueva de cada función para nada.

La comparación es **gruesa a propósito**: mira `supabase/` entero, no
migraciones y funciones por separado. Afinar más traería el fallo clásico —
un despliegue falla, el commit siguiente solo toca una de las dos carpetas, y
la otra se queda atrás sin que nadie lo note.

Para forzarlo: **Actions → Deploy → Run workflow**.

### El token caduca, y hay dos avisos

El access token de Supabase vence. Cuando pasa, el despliegue falla con un
401 que no explica nada.

| Aviso | Cuándo |
|---|---|
| **Canario semanal** | Lunes 9:00 UTC. Si el token no sirve, el workflow falla y GitHub manda un correo |
| **Preflight del deploy** | Antes de tocar la base. Falla diciendo qué hacer, no a mitad de las migraciones |

No se puede avisar *antes* de que caduque: la API de Supabase no expone la
fecha de vencimiento de un token. Lo que sí se consigue es enterarse un lunes
tranquilo en vez de en mitad de un despliegue.

**Renovarlo son tres pasos:** account/tokens → *Generate new token* →
actualizar el secret en GitHub.

### Qué hace, y en qué orden

```
1. supabase link      ← enlaza el proyecto
2. supabase db push   ← migraciones: CREA LAS TABLAS
3. supabase functions deploy
```

El orden no es intercambiable. **Una Edge Function no crea tablas**, solo lee
y escribe en las que existen. Al revés, el primer webhook falla con
`relation "webhook_events" does not exist`.

### Lo que hay que configurar una vez

Settings → Secrets and variables → Actions:

| | Tipo | De dónde sale |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | **Secret** | supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_PASSWORD` | **Secret** | La contraseña de la base, al crear el proyecto |
| `SUPABASE_PROJECT_REF` | **Variable** | El ID del proyecto. No es sensible |

Estos tres **sí** van en GitHub, y no contradicen la regla de
`docs/SECURITY.md`: no son secretos del producto, son credenciales de
despliegue. `GEMINI_API_KEY` y los de Telegram siguen viviendo solo en
`supabase secrets set`.

### Volver a desplegar sin tocar el código

Actions → Deploy → *Run workflow*.

## Comandos

```bash
# Verificación local, lo mismo que corre el CI
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm test:integration

# Supabase en local
supabase start
supabase functions serve telegram-webhook
supabase db reset
```

---

**Fuentes:**
[Cloudflare Tunnel en 2026](https://dev.to/recca0120/cloudflare-tunnel-in-2026-expose-localhost-without-opening-ports-or-buying-an-ip-32l5) ·
[Preview con Cloudflare Tunnel](https://developers.cloudflare.com/pages/how-to/preview-with-cloudflare-tunnel/) ·
[Alternativas para webhooks](https://hookdeck.com/webhooks/platforms/cloudflare-tunnel-alternatives-for-local-webhook-development) ·
[vitest-coverage-report-action](https://github.com/davelosert/vitest-coverage-report-action)
