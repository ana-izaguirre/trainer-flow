# SPEC-033 — Panel web de solo lectura (V2)

| Campo | Valor |
|---|---|
| **Estado** | **APROBADA PARA V2 — en implementación.** Stack y alcance confirmados por Ana; falta solo decidir autenticación (§3.3) antes de tocar el login. No se "construye en V1" en el sentido de CLAUDE.md porque V1 ya cerró — esto entra como trabajo de V2 |
| **Depende de** | SPEC-009, SPEC-020, SPEC-021, SPEC-024 |
| **Sesiones** | Por asignar — no entra en el roadmap de V1 |

## 1. Objetivo

Que el entrenador pueda **ver** su cartera completa, la tendencia de sus
clientes y el detalle de cada rutina desde un navegador, sin perder ninguna
capacidad de **decidir** — eso se queda en Telegram.

## 2. El problema que resuelve, y por qué no es urgente

Telegram sirve bien para actuar sobre un cliente a la vez: aprobar, editar,
revisar un check-in. No sirve para **mirar en conjunto**: comparar la
tendencia de 15 clientes, ver quién no contesta hace dos semanas, repasar el
histórico completo de una rutina. Eso hoy exige scrollear mensajes o entrar a
Supabase Studio.

No es urgente porque, con una cartera chica, un vistazo a `/clientes` y
`/checkins` alcanza. Se vuelve real cuando la cartera crece lo suficiente
para que "cuál de todos necesita atención" deje de caber en la cabeza.

## 3. La decisión de diseño

### 3.1 Escribir sigue en Telegram. Sin excepción.

```
Escribir  →  Telegram (aprobar, editar, enviar, crear)
Leer      →  web (clientes, rutinas, check-ins, de un vistazo)
```

El panel **no tiene ningún botón de acción** en su primera versión. Ninguna
transición de `version_state`, ninguna generación por IA, ninguna edición se
dispara desde la web. Esto no es una limitación temporal: es lo que evita
duplicar toda la autorización de escritura (`_core/authorization.ts`) en un
segundo canal, y lo que mantiene intacto el principio "la IA propone, el
entrenador decide" sin tener que probarlo otra vez en una superficie nueva.

Si algún día se decide que el panel también escribe, **eso es una spec
nueva**, no una ampliación silenciosa de esta.

### 3.2 Por qué sale barato: se reusa `_core` entero

```
_core/domain/          →  los mismos tipos (Workout, WorkoutVersion…)
_core/authorization.ts →  la misma regla de "esto es tuyo o no"
_core/telegram/format.ts → el mismo texto, sin el escape de MarkdownV2
```

`_core` es TypeScript puro sin dependencias (ADR-001): una web en Node
importa el dominio, las validaciones y el criterio de autorización
directamente. No se reescribe "quién puede ver qué" en un segundo lugar para
que, con el tiempo, diga algo distinto de lo que dice el bot.

### 3.3 Autenticación: Telegram Login Widget + sesión JWT

**Decidido.** El entrenador entra con su cuenta de Telegram — reusa el
`telegramUserId` que `profiles` ya tiene como identidad verificada, sin
guardar ningún dato nuevo (se descarta el magic link por email: pedía un
campo que el modelo no tiene hoy).

**Login.** El widget de Telegram devuelve un payload firmado (`id`,
`first_name`, `auth_date`, `hash`, …). El servidor Next.js verifica `hash`
con HMAC-SHA256 contra `TELEGRAM_BOT_TOKEN` (mismo secreto que ya usa el
bot, no uno nuevo) — igual criterio que `_core/security/constant-time.ts`
ya aplica para `TELEGRAM_WEBHOOK_SECRET`: nunca confiar en el payload sin
verificar su firma primero.

**Sesión: JWT, sin estado en servidor.** Verificado el widget, el servidor
busca el `profile` por `telegramUserId` y, solo si `role = 'trainer'`, firma
un JWT propio (`profileId`, `role`, `exp`) con un secreto nuevo
(`PANEL_JWT_SECRET` — no se reusa `TELEGRAM_BOT_TOKEN` ni ningún otro: cada
secreto tiene un solo uso, CLAUDE.md sección Secretos) y lo guarda en una
cookie `httpOnly; secure; sameSite=lax`. Si el `profile` es `client` o no
existe, el login falla — **el panel es solo para entrenadores**, nunca para
un cliente que por error probara el mismo widget.

**Autorización: por rol, en dos capas — ninguna es decorativa.**
1. *Middleware* (`web/middleware.ts`): sin JWT válido y sin expirar, o con
   `role !== 'trainer'`, no se sirve ninguna página del panel — redirige al
   login. Esto solo contesta "¿puede entrar?".
2. *Dato* (`_core/authorization.ts`, reusado tal cual — §3.2): cada ruta
   filtra por el `profileId`/`trainer_id` que viene DENTRO del JWT ya
   verificado, nunca por uno recibido en la URL o el body. "¿Puede entrar?"
   y "¿esto es suyo?" son preguntas distintas; el JWT solo contesta la
   primera, `authorization.ts` sigue siendo la única fuente de verdad de
   la segunda — mismo criterio exacto que ya aplica del lado de Telegram.

Pendiente, operacional (no bloquea escribir código): confirmar en BotFather
(`/setdomain`) el dominio donde se despliega el panel — el widget exige un
dominio autorizado por bot. `PANEL_JWT_SECRET` se suma a `docs/SECURITY.md`
cuando esto se implemente, mismo trato que cualquier otro secreto.

### 3.4 Stack técnico

| Pieza | Elección | Por qué |
|---|---|---|
| Framework | Next.js (App Router, server-rendered) | Sin estado propio que mantener, coincide con §6 ("no hace falta websockets") |
| UI | **shadcn/ui** sobre **Tailwind CSS** | Componentes accesibles por default (Radix UI debajo: foco, roles ARIA, manejo de teclado ya resueltos) — no se reinventa un sistema de diseño para una vista de solo lectura |
| Animación | **Motion** (ex Framer Motion), solo donde ayude a leer el cambio — transición de carga, expandir el detalle de un cliente, nunca decorativa | "Si es necesario" (criterio de Ana): una animación que no aclara un cambio de estado no se agrega |
| Monorepo | `pnpm-workspace.yaml` nuevo en la raíz, paquete `web/` | Es la única forma de importar `_core/` **directo** (§3.2) sin publicarlo como paquete aparte — un repo separado rompería esa reutilización |
| E2E | Playwright (ya preinstalado en los entornos de ejecución del proyecto) | Mismo criterio que el resto del repo: nada se da por "funciona" sin un test que lo pruebe |

### 3.5 No funcionales — igual de obligatorios que el alcance funcional

- **Accesibilidad**: WCAG 2.1 AA como piso. Navegación completa por teclado,
  foco visible, `aria-label` en todo control sin texto visible, contraste
  verificado en ambos temas. shadcn/Radix ya resuelve la mayoría de esto en
  los componentes base — lo que se verifica es que no se rompa al
  personalizarlos.
- **Responsive**: mobile-first (igual que el resto del producto: el
  entrenador ya vive en el celular con Telegram). Un layout que solo
  funciona en desktop no cumple la spec, aunque la vista "funcione".
- **Paginación y lazy loading**: ninguna vista carga toda la cartera ni todo
  el histórico de una sola vez (§3.6). Una lista pagina; una sección pesada
  (el histórico completo de check-ins de un cliente, por ejemplo) carga
  bajo demanda, al expandirla — no en el primer render de la página.
- **E2E**: cada criterio de aceptación de §8 tiene un test de Playwright que
  lo prueba de punta a punta (login → navegación → dato visible), no solo
  tests de componente aislado. Esto es parte de la Definition of Done de
  esta spec, no un "si alcanza el tiempo".

### 3.6 KPIs, reportes y progreso — agregados en SQL, no en el cliente

Ana pidió que el panel muestre KPIs/reportes de la cartera y el progreso de
cada cliente, además del listado y el detalle ya descritos.

**La agregación vive en Postgres, igual que el resto de las consultas del
entrenador (§3.2, §5)** — nunca se trae la tabla completa al navegador para
sumarla ahí. Dos funciones RPC nuevas, mismo patrón que `trainer_clients`:

- `trainer_kpis(p_trainer_id)` — una fila: cartera activa, sin vincular,
  check-ins pendientes, distribución de `version_state`, tasa de adherencia
  (check-ins respondidos / esperados en las últimas N semanas). Los números
  que ya arma `/clientes` y `/checkins` en Telegram, contados en SQL en vez
  de leídos uno por uno.
- `trainer_client_progress(p_client_id, p_limit, p_cursor)` — la serie de
  check-ins de un cliente (semana, sesiones, sensación, molestia), paginada:
  es el historial completo de alguien con meses de seguimiento, no una lista
  corta.

**Por qué esto no es SPEC-034.** Son KPIs de la cartera de UN entrenador,
calculados sobre sus propios datos — no una vista agregada ENTRE
entrenadores (eso sigue siendo explícitamente SPEC-034, sin diseño hasta que
Ana responda sus preguntas de negocio). `trainer_kpis` recibe `trainer_id` y
filtra por él, igual que todo lo demás en esta spec.

**Progreso de cliente** se muestra en la vista de detalle (§4), como
gráfico simple (sesiones por semana, sensación en el tiempo) — no agrega una
página nueva. Es lectura, así que entra en la misma regla de "espejo, no
entrada" que el resto de §4.

## 4. Alcance

**Incluye (V2):**
- Login del entrenador.
- Vista de cartera: todos sus clientes con estado (`clients.status`,
  SPEC-024) y la versión vigente de cada uno. Paginada (§3.6).
- Vista de detalle de un cliente: rutina actual, histórico de versiones
  (solo lectura — ver, no comparar diffs: eso sigue fuera de alcance, ver
  CLAUDE.md "Diffing entre versiones"), histórico de check-ins (SPEC-021) y
  su progreso como gráfico (§3.6), con lazy loading del histórico completo.
- Vista de señales: quién no contesta, quién pidió un cambio sin resolver.
- Vista de KPIs/reportes de la cartera (§3.6): cuánta gente activa, cuántos
  check-ins pendientes, distribución de estados, adherencia.

**No incluye (ni en esta V2):**
- Cualquier escritura: aprobar, editar, enviar, crear, responder.
- Vista para el cliente — el cliente sigue solo en Telegram.
- Multi-entrenador o cualquier vista agregada entre entrenadores (SPEC-034).
- Notificaciones propias del panel (push, email). Las notificaciones siguen
  siendo Telegram.
- Generar o tocar datos de ningún tipo: es un espejo, no una entrada.

## 5. Contratos (boceto, no definitivo)

```
GET /clientes?cursor=            → lista paginada, con estado y último movimiento
GET /clientes/:clientId          → rutina vigente + histórico + check-ins (primera página)
GET /clientes/:clientId/progreso?cursor= → serie de check-ins paginada, para el gráfico (§3.6)
GET /kpis                        → agregados de la cartera (§3.6)
```

Cada ruta exige la sesión del entrenador y filtra por `trainer_id`, con la
misma regla que ya aplica `authorization.ts` del lado de Telegram — no una
reescrita, una llamada a la misma función.

## 6. Lo que queda abierto, y no bloquea construir

- **Dominio en BotFather para el Telegram Login Widget** (§3.3) — se
  confirma al desplegar, no antes.
- ¿Hosting? Next.js server-rendered corre en Vercel (free tier) sin cambios;
  se confirma al desplegar, no bloquea construir.
- Tamaño de página para la paginación (§3.6) — se ajusta con datos reales
  durante la implementación, no es una decisión que valga la pena fijar antes.

## 7. Por qué esto es V2 y no V1

CLAUDE.md lo dice explícito: "Dashboard web · Frontend" están en la lista de
qué no construir en V1. La razón de fondo, ya anotada en `ROADMAP.md`:
**nada de lo que hay que aprender de los primeros dos meses de uso real se
aprende más rápido teniendo un panel.** El riesgo real del proyecto hoy no es
la falta de una vista agregada — es si el flujo completo (evaluación → IA o
plantilla → aprobación → entrega → check-in) funciona con clientes de
verdad. Un panel antes de eso es resolver un problema que todavía no se
tiene.
