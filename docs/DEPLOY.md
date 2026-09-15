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
| `pnpm typecheck` | TypeScript estricto, sin errores |
| `pnpm lint` | oxlint, incluido el aislamiento de `_core` (ADR-001) |
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
# scripts/dev-tunnel.sh  (se escribirá en S-09)
cloudflared tunnel --url http://localhost:54321 > tunnel.log 2>&1 &
URL=$(grep -oE 'https://[a-z-]+\.trycloudflare\.com' tunnel.log | head -1)

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${URL}/functions/v1/telegram-webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Un script, dos comandos. **La fricción desaparece.**

### Recomendación

| Cuándo | Qué |
|---|---|
| **S-09**, al crear el bot | Quick Tunnel + el script de arriba + **un bot de pruebas aparte del real** |
| Si la URL cambiante molesta | Named Tunnel con un dominio propio |
| Producción | Nada de esto: las Edge Functions ya tienen URL pública |

**Lo importante no es el túnel, es el bot de pruebas.** Un bot separado del
que usa tu esposo evita que una prueba tuya le llegue a un cliente real.

---

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
