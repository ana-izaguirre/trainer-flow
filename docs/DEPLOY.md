# TrainerFlow — CI, despliegue y desarrollo local

Tres cosas distintas que conviene no mezclar:

| | Qué es | Estado |
|---|---|---|
| **CI** | Que nada roto llegue a `main` | ✅ Activo |
| **CD** | Desplegar a Supabase | ✅ Automático desde `main` |
| **Local** | Ver los cambios funcionando | 📋 Documentado abajo |

**¿Es la primera vez?** Ve directo al checklist de aquí abajo. El resto del
documento explica *por qué* funciona así; el checklist es *qué teclear*.

---

# Checklist — la primera vez

Diez pasos. **El orden importa en dos sitios**, y están marcados.

Sustituye `<ref>` por el ID de tu proyecto de Supabase y `<TOKEN>` por el del
bot en todo lo que sigue.

## A. Antes de desplegar

- [ ] **1. Crear el proyecto en Supabase** y apuntar el *project ref* y la
      contraseña de la base. Las dos hacen falta en el paso 2.

- [ ] **2. Las tres credenciales de despliegue, en GitHub**
      (Settings → Secrets and variables → Actions):

      | | Tipo | De dónde sale |
      |---|---|---|
      | `SUPABASE_ACCESS_TOKEN` | Secret | supabase.com/dashboard/account/tokens |
      | `SUPABASE_DB_PASSWORD` | Secret | La del paso 1 |
      | `SUPABASE_PROJECT_REF` | Variable | El *ref* del paso 1 |

      Estas tres **sí** van en GitHub y no rompen la regla de `SECURITY.md`:
      son credenciales de despliegue, no secretos del producto.

- [ ] **3. Generar los dos secretos que te inventas tú**, y guardarlos donde
      guardes las contraseñas — los vas a necesitar otra vez en los pasos 6 y 8:

      ```bash
      openssl rand -hex 32    # → TELEGRAM_WEBHOOK_SECRET
      openssl rand -hex 32    # → CHECKIN_CRON_SECRET
      openssl rand -hex 32    # → SWEEP_CRON_SECRET
      ```

- [ ] **4. ⚠️ Los secretos del producto, ANTES de desplegar.** Este es el
      primer sitio donde el orden importa: una Edge Function sin sus variables
      **revienta al arrancar**, no al primer mensaje.

      ```bash
      supabase link --project-ref <ref>
      supabase secrets set TELEGRAM_BOT_TOKEN='...'        # BotFather
      supabase secrets set TELEGRAM_BOT_USERNAME='mibot'   # sin @, el de BotFather
      supabase secrets set TELEGRAM_WEBHOOK_SECRET='...'   # el del paso 3
      supabase secrets set TALLY_SIGNING_SECRET='...'      # panel de Tally
      supabase secrets set GEMINI_API_KEY='...'            # Google AI Studio
      supabase secrets set CHECKIN_CRON_SECRET='...'       # el del paso 3
      supabase secrets set SWEEP_CRON_SECRET='...'         # el del paso 3
      ```

      `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` **no se ponen**: Supabase
      los inyecta en toda Edge Function. Ponerlos a mano no hace daño, pero
      tampoco hace nada.

      Y estas tres son opcionales —no son secretos, pero van por el mismo
      sitio— y **se cambian sin volver a desplegar**:

      ```bash
      supabase secrets set AI_MODEL='gemini-2.5-flash'   # fijar un modelo concreto
      supabase secrets set AI_MAX_CALLS='20'             # 0 apaga la IA
      supabase secrets set AI_WINDOW_MINUTES='60'
      ```

      `AI_MODEL` es la que importa: si el proveedor retira el modelo, **todas**
      las generaciones fallan con 404 y esto lo arregla en un minuto. Por
      defecto se usa un alias móvil justamente para que eso no pase solo.

- [ ] **4b. Actualizar datos: el enlace del formulario** (SPEC-027).
      Para que un cliente pueda cambiar sus datos con `/actualizar_datos`, o que tú
      se lo pidas con 📝 desde su ficha:

      1. En Tally, añade al formulario un **campo oculto** llamado exactamente
         `update` (Integrations → Hidden fields, o el bloque *Hidden fields*).
      2. Pasa al bot el enlace público del formulario:

         ```bash
         supabase secrets set TALLY_FORM_URL='https://tally.so/r/<id>'
         ```

      No es un secreto —es el mismo enlace que le mandas a cada cliente—,
      pero va por el mismo sitio. **Es opcional**: sin él, el bot funciona
      igual y `/actualizar_datos` responde que todavía no está disponible.

      > ⚠️ **Sin el campo oculto, un envío por el enlace de actualización se
      > procesa como un cliente nuevo**: Tally no devuelve el token, y el bot
      > no tiene forma de saber que es la misma persona. No se pierde el
      > dato, pero aparece duplicado.

## B. Desplegar

- [ ] **5. Mergear a `main`.** El CI corre; si pasa, el deploy aplica las
      migraciones y sube las cuatro funciones. Se ve en Actions → Deploy.

      Comprueba que están las cuatro:

      ```bash
      supabase functions list
      # telegram-webhook · tally-webhook · generate-version · weekly-checkin
      ```

## C. Conectar el mundo exterior

- [ ] **6. Registrar el webhook de Telegram** con el secreto del paso 3:

      ```bash
      curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
        -d "url=https://<ref>.supabase.co/functions/v1/telegram-webhook" \
        -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
      ```

      Verifica: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.
      `pending_update_count` alto o `last_error_message` con algo dentro
      significa que el bot no está atendiendo.

- [ ] **6b. El menú de comandos de Telegram** (el botón `/` junto al mensaje).
      Nunca se puso por código —no hay ningún `setMyCommands` en el
      proyecto—, así que es manual, por cualquiera de las dos vías.

      **Con el token, sin pasar por BotFather.** Telegram no distingue el
      menú por rol en un chat 1 a 1 —el mismo bot atiende a los dos—, así
      que se resuelve con dos llamadas: el menú **por defecto** (el que ve
      cualquiera, clientes nuevos incluidos) lleva solo lo del cliente, y tu
      propio chat lleva el del entrenador encima.

      ```bash
      # 1. El menú por defecto — solo cliente
      curl "https://api.telegram.org/bot<TOKEN>/setMyCommands" \
        -H "Content-Type: application/json" \
        -d '{
          "scope": {"type": "default"},
          "commands": [
            {"command": "rutina", "description": "ver tu rutina actual"},
            {"command": "cambio_rutina", "description": "pedir un cambio a tu rutina"},
            {"command": "actualizar_datos", "description": "actualizar datos"},
            {"command": "ayuda", "description": "qué puedes hacer"}
          ]
        }'

      # 2. Tu menú — superpuesto por tu chat_id (el del paso 9, más abajo)
      curl "https://api.telegram.org/bot<TOKEN>/setMyCommands" \
        -H "Content-Type: application/json" \
        -d '{
          "scope": {"type": "chat", "chat_id": <TU_CHAT_ID>},
          "commands": [
            {"command": "clientes", "description": "listar tus clientes"},
            {"command": "cliente", "description": "ver la ficha de un cliente"},
            {"command": "pendientes", "description": "rutinas y enlaces esperando"},
            {"command": "checkins", "description": "check-ins sin responder"},
            {"command": "crear_rutina", "description": "dictar una rutina completa"},
            {"command": "ayuda", "description": "qué puedes hacer"}
          ]
        }'
      ```

      Verifica sin cambiar nada: `curl "https://api.telegram.org/bot<TOKEN>/getMyCommands"`
      (con `-d 'scope={"type":"chat","chat_id":<TU_CHAT_ID>}'` para ver el tuyo).

      **O a mano**, en **@BotFather → tu bot → Edit Bot → Edit Commands**, o
      con `/setcommands` — ahí no hay `scope`, así que solo sirve para un
      menú único (la lista combinada de los dos roles).

      Cada comando ya responde «eso solo lo puede tu entrenador» si no le
      toca (SPEC-007 regla 1), así que el peor caso de mezclar los dos
      menús es un botón que no hace nada — nunca un acceso indebido.

- [ ] **7. Tally — Integrations → Webhooks:**
      `https://<ref>.supabase.co/functions/v1/tally-webhook`

      > ⚠️ **La pantalla final de Tally NO puede llevar el deep link.**
      > Este documento decía que se configurara con
      > `https://t.me/<tu_bot>?start=` + el `link_token`, y eso es imposible:
      > la URL de redirección se configura **antes** de la respuesta, y el
      > `link_token` lo genera el servidor **después**, al recibirla. Tally no
      > tiene forma de conocerlo.
      >
      > Hoy el enlace se saca a mano de la base — está en **«El camino
      > entero»**, más abajo. Cerrar ese hueco está pendiente de decidir:
      > ponerlo en el aviso que ya recibe el entrenador, o pre-generar el
      > token antes de mandar el formulario.

- [ ] **8. Programar el check-in semanal.** En el SQL Editor de Supabase:
      pega `supabase/cron/weekly-checkin.sql` y ejecútalo —eso crea la
      función, no el job—, y después:

      ```sql
      select schedule_weekly_checkin(
        'https://<ref>.supabase.co/functions/v1/weekly-checkin',
        '<CHECKIN_CRON_SECRET>'   -- el del paso 3
      );
      ```

      Comprueba:
      ```sql
      select jobname, schedule, active from cron.job where jobname = 'weekly-checkin';
      ```

- [ ] **8b. Programar el barrido de cada 5 minutos** (SPEC-002 §11 y
      SPEC-030 regla 13). En el SQL Editor: pega
      `supabase/cron/sweep-generating.sql` y ejecútalo, y después:

      ```sql
      select schedule_generation_sweep(
        'https://<ref>.supabase.co/functions/v1/sweep-generating',
        '<SWEEP_CRON_SECRET>'   -- el del paso 3
      );
      ```

      Comprueba:
      ```sql
      select jobname, schedule, active from cron.job where jobname = 'sweep-generating';
      ```

      **Un solo job, dos comprobaciones.** El nombre se quedó del primer uso
      —generaciones de IA atascadas—, pero la misma llamada también revisa
      los enlaces sin abrir a las 48 horas (SPEC-030 regla 13): no hace
      falta programar nada aparte. Sin este paso, ninguna de las dos redes
      de seguridad corre — el resto del sistema funciona igual.

      > **El deploy lo vigila.** Cada despliegue termina comprobando que
      > `weekly-checkin` y `sweep-generating` existan y estén activos. Si
      > falta alguno, el run de *Deploy* sale en rojo nombrando el paso (8 u
      > 8b). El código ya quedó desplegado: lo único que falta es el paso
      > manual que indica el error.

## D. Darte de alta

- [ ] **9. ⚠️ Tu perfil de entrenador, ANTES de la primera evaluación.**
      Segundo sitio donde el orden importa: el webhook de Tally busca al
      entrenador para avisarle, y si no existe, **no marca el evento como
      procesado**. Tally reintenta, y la evaluación se queda sin entrar.

      No hay alta automática, y es a propósito (SPEC-009 regla 1). En el SQL
      Editor, con tu `telegram_user_id` —te lo dice `@userinfobot`—:

      ```sql
      insert into profiles (telegram_user_id, telegram_chat_id, role, full_name)
      values (<tu_id>, <tu_id>, 'trainer', 'Tu nombre');
      ```

- [ ] **10. Comprobar que el bot te reconoce.** Escríbele `/ayuda`.

      Tiene que contestarte con la lista de comandos. Si lo hace, la identidad
      del paso 9 funciona y ya puedes usar `/clientes`, `/cliente <nombre>`,
      `/pendientes` y `/checkins`.

      Si responde *«no te tengo registrado»*, el `telegram_user_id` del paso 9
      no es el tuyo.

      Si no contesta nada, mira Edge Functions → `telegram-webhook` → Logs:
      cada petición deja una línea con su `request_id`.

---

## Probar sin esperar a nada

**El check-in**, sin esperar al lunes:

```bash
curl -X POST 'https://<ref>.supabase.co/functions/v1/weekly-checkin' \
  -H 'x-checkin-cron-secret: <el del paso 3>'
```

Es seguro repetirlo: el `UNIQUE (client_id, version_id, week_number)` decide
qué check-ins existen, no el número de llamadas. Devuelve los contadores de la
pasada:

```json
{"sent":0,"reminded":0,"skipped":3,"failed":0}
```

Sin la cabecera responde `401`, que es justo lo que tiene que pasar.

**Una evaluación firmada, sin tocar Tally:**

```bash
TALLY_SIGNING_SECRET='...' SUPABASE_PROJECT_REF='...' \
  ./scripts/simular-tally.sh "Carlos Prueba"
```

Manda el fixture real de `tests/fixtures/` con una firma válida y un `eventId`
nuevo en cada disparo — sin eso, el segundo intento responde `duplicate`, que
es correcto pero no es lo que quieres mientras pruebas.

### El camino entero

Dispara la evaluación (o rellena tu formulario). Te llega el aviso, eliges cómo
preparar la rutina, y al aprobarla queda en `APPROVED`.

Para que le llegue a alguien hacen falta **dos cosas más**:

**1. Otra cuenta de Telegram.** `ensure_client_profile` devuelve `null` si el
perfil ya es entrenador: **no puedes ser cliente y entrenador con la misma
cuenta.** Es deliberado (SPEC-009 regla 1), pero significa que para probar la
entrega necesitas una segunda cuenta.

**2. El enlace del cliente, a mano por ahora.** Ningún mensaje lo entrega
todavía: el `link_token` se crea y se guarda, pero no sale en el aviso ni en
`/clientes`. Sácalo del SQL Editor:

```sql
select c.full_name,
       'https://t.me/TU_BOT?start=' || c.link_token as enlace,
       case when c.linked_at is null then 'sin vincular' else 'vinculado' end as estado
  from clients c order by c.created_at desc limit 5;
```

Abre ese enlace desde la **otra** cuenta. Ahí sí: se vincula, y si ya había una
rutina en `APPROVED`, le llega en ese momento.

## Si algo no responde

| Síntoma | Dónde mirar primero |
|---|---|
| No contesta a nada | `getWebhookInfo` → `last_error_message` |
| Contesta «no te tengo registrado» | Falta el paso 9, o el `telegram_user_id` no es el tuyo |
| Tally devuelve **401** | Hay dos 401 distintos y no se parecen en nada: ver abajo |
| La función revienta al arrancar | Falta un secreto del paso 4. El log dice **cuál** |
| El cliente no recibe su rutina | ¿Canjeó el deep link? Sin vincular se queda en `APPROVED` |
| El check-in no sale | `select * from cron.job` — ¿existe el job del paso 8? |

Los logs están en el panel: Edge Functions → la función → Logs. Todo lleva
`request_id`, así que una petición se sigue de punta a punta.

### Los dos 401, y cómo distinguirlos

Un webhook que devuelve 401 puede estar fallando en **dos sitios que no se
parecen**, y desde fuera se ven idénticos:

```
Tally ──► pasarela de Supabase ──► función ──► base
             ▲                        ▲
          401 (A)                  401 (B)
       falta el JWT            la firma no cuadra
```

**Se distinguen por los logs**, en Edge Functions → la función → Logs:

| | ¿Hay línea en los logs? | Qué pasó |
|---|---|---|
| **A** | **No**, ninguna | La pasarela cortó antes. La función ni se enteró |
| **B** | **Sí** | La función corrió y rechazó la firma |

**El caso A es el que muerde en el primer despliegue.** Por defecto Supabase
exige un JWT antes de ejecutar la función, y ni Tally, ni Telegram, ni
`pg_cron` mandan uno. Se apaga por función en `supabase/config.toml`:

```toml
[functions.tally-webhook]
verify_jwt = false
```

Eso no las deja abiertas: cada una comprueba lo suyo —la firma de Tally, el
`secret_token` de Telegram, el `x-checkin-cron-secret` del cron— y esa
comprobación va atada a quien debe llamarla, cosa que un JWT genérico no hace.
`generate-version` sí lo conserva: es interna y se la llama con la service
role key.

Si ya está desplegada sin eso, no hace falta esperar a un merge:

```bash
supabase functions deploy tally-webhook --no-verify-jwt
```

**El caso B** sí es el secreto: el de `supabase secrets set
TALLY_SIGNING_SECRET` tiene que ser, carácter por carácter, el que muestra
Tally en su panel del webhook.

**Si el síntoma no está en esa tabla:** [`docs/RUNBOOK.md`](RUNBOOK.md) tiene
los recorridos completos, con las consultas SQL ya escritas. La idea es que se
empieza por la base —que es el índice— y con el `request_id` que salga de ahí
se leen los logs.

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

## CD — despliegue a Supabase

Ya está automatizado: lo hace `.github/workflows/deploy.yml` cuando el CI pasa
en `main`. El detalle está en **Despliegue automático**, más abajo.

Por debajo son estos dos comandos, que **no hace falta correr a mano**:

```bash
supabase db push            # aplica las migraciones
supabase functions deploy   # sube las Edge Functions
```

> ⚠️ **`supabase db push` sobre producción aplica migraciones sin vuelta atrás.**
> Por eso el workflow depende del de CI y dispara **solo** desde `main`, nunca
> desde una rama.

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

Las tres credenciales de despliegue son el **paso 2** del checklist.

Van en GitHub y no contradicen la regla de `docs/SECURITY.md`: son
credenciales de despliegue, no secretos del producto. `GEMINI_API_KEY` y los
de Telegram siguen viviendo solo en `supabase secrets set`.

### Volver a desplegar sin tocar el código

Actions → Deploy → *Run workflow* → rama `main`, destino `production`.

Producción **solo acepta `main`**: si eliges otra rama con destino
`production`, el deploy se niega antes de tocar nada.

## Staging — probar sin tocar producción

Un segundo proyecto de Supabase con su propio bot de Telegram. Existe porque
probar en producción obliga después a borrar datos a mano, y un `DELETE`
equivocado ahí no tiene vuelta.

| | Producción | Staging |
|---|---|---|
| Cuándo despliega | Solo, en cada merge a `main` | A mano, desde **cualquier rama** |
| Aprobación manual | Configurable (*Required reviewers*) | No |
| Jobs de pg_cron | Obligatorios (el deploy los vigila) | No hacen falta |
| Bot de Telegram | El real | Uno de pruebas |

### Montarlo, una sola vez

- [ ] **S1. Crear el proyecto** en Supabase (por ejemplo
      `trainer-flow-staging`) y apuntar su *project ref* y su contraseña de
      base de datos. El plan gratuito alcanza, pero **pausa los proyectos
      inactivos**: si un deploy a staging falla sin razón aparente, mira si
      está pausado.
- [ ] **S2. Las credenciales en GitHub**, con nombres **propios**
      (Settings → Secrets and variables → Actions):

      | | Tipo |
      |---|---|
      | `STAGING_SUPABASE_PROJECT_REF` | Variable |
      | `STAGING_SUPABASE_DB_PASSWORD` | Secret |

      `SUPABASE_ACCESS_TOKEN` se comparte: es de tu cuenta, no del proyecto.

      > **Por qué nombres propios.** Si staging usara los mismos nombres
      > dentro de su *environment*, un secreto olvidado caería en silencio en
      > el de producción. Con nombres propios, lo que falte es un error que
      > lo nombra, y el deploy también se niega si el ref de staging es igual
      > al de producción.

- [ ] **S3. Un bot de pruebas** en BotFather (por ejemplo
      `@trainerflow_pruebas_bot`). Tu cuenta de Telegram sirve para los dos
      bots: son chats distintos.
- [ ] **S4. Los secretos del producto en el proyecto de staging**, igual
      que el paso 4 pero enlazado a staging y con el token del bot de
      pruebas:

      ```bash
      supabase link --project-ref <ref-de-staging>
      supabase secrets set TELEGRAM_BOT_TOKEN='...'        # el del bot de pruebas
      supabase secrets set TELEGRAM_BOT_USERNAME='...'     # sin @
      supabase secrets set TELEGRAM_WEBHOOK_SECRET='...'   # uno nuevo, no el de producción
      supabase secrets set GEMINI_API_KEY='...'
      ```

      Son los que piden `telegram-webhook` y `generate-version`. Los de
      Tally y de los crons (`TALLY_SIGNING_SECRET`, `CHECKIN_CRON_SECRET`,
      `SWEEP_CRON_SECRET`) solo hacen falta si conectas esas piezas en
      staging.

      Después **vuelve a enlazar producción** (`supabase link --project-ref
      <ref>`) si usas el CLI desde tu máquina para otras cosas.
- [ ] **S5. Primer deploy:** Actions → Deploy → *Run workflow* → rama
      `main`, destino `staging`.
- [ ] **S6. Conectar el bot de pruebas** al webhook de staging (paso 6 del
      checklist, con el ref de staging y el secreto de S4).
- [ ] **S7. Tu perfil de entrenador en staging** (paso 9, contra la base
      de staging).

Tally es opcional: sin él, en staging se crean las rutinas a mano o desde
plantilla, que es el camino que más se prueba de todas formas.

### Usarlo

- **Probar una rama antes de mergearla:** *Run workflow* → esa rama →
  `staging`. Habla con el bot de pruebas.
- **Empezar de cero:** en staging no hace falta borrar filas a mano:
  `supabase db reset --linked` con staging enlazado, y se vuelven a aplicar
  las migraciones.

> ⚠️ Una migración de una rama sin mergear queda aplicada en staging. Si
> después la cambias antes de mergear, staging queda desalineado: resetéalo.

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

---

## El check-in semanal — por qué es el único paso manual

Cómo se programa está en el **paso 8** del checklist. Aquí queda el motivo,
que es lo que no se ve al teclearlo.

`pg_cron` dispara `weekly-checkin` los lunes a las 9:00 UTC, y
`sweep-generating` cada 5 minutos (paso 8b). **Ninguno de los dos está en
las migraciones a propósito**, por dos razones independientes:

· Programarlo necesita la URL del proyecto y una credencial. En una migración,
  o iría un secreto commiteado —bloqueante— o fallaría en cada `db reset`.

· `pg_cron` y `pg_net` son extensiones de Supabase. Los tests corren contra un
  PostgreSQL pelado, donde `create extension` falla.

### Cambiar la hora, o el secreto

Se vuelve a llamar a `schedule_weekly_checkin`. **Reemplaza** el job en vez de
añadir otro, así que llamarla dos veces no deja dos crons mandando el mismo
check-in.

### Por qué la función pide su propio secreto

Está expuesta a internet. Sin `x-checkin-cron-secret`, cualquiera podría
dispararla en bucle y llenar de check-ins el Telegram de todos los clientes.
Se compara en tiempo constante, igual que el de Telegram.
