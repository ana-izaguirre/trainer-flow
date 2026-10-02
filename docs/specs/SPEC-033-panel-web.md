# SPEC-033 — Panel web de solo lectura (V2)

| Campo | Valor |
|---|---|
| **Estado** | **BORRADOR** — V2. No se implementa en V1 (CLAUDE.md, "Qué NO construir en V1": Dashboard web · Frontend) |
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

### 3.3 Autenticación: Telegram sigue siendo la identidad

El entrenador ya tiene una identidad verificada: su `telegramUserId`
(`profiles`). Dos caminos, a decidir cuando esto se construya:

- **Telegram Login Widget** — el entrenador entra con su cuenta de Telegram,
  igual que hoy el bot ya sabe quién es.
- **Magic link por email** — más estándar para web, pero exige guardar un
  email verificado que hoy `profiles` no tiene.

El primero reusa lo que ya existe; el segundo pide un dato nuevo. Se decide
antes de construir, no aquí.

## 4. Alcance

**Incluye (V2):**
- Login del entrenador.
- Vista de cartera: todos sus clientes con estado (`clients.status`,
  SPEC-024) y la versión vigente de cada uno.
- Vista de detalle de un cliente: rutina actual, histórico de versiones
  (solo lectura — ver, no comparar diffs: eso sigue fuera de alcance, ver
  CLAUDE.md "Diffing entre versiones"), histórico de check-ins (SPEC-021).
- Vista de señales: quién no contesta, quién pidió un cambio sin resolver.

**No incluye (ni en esta V2):**
- Cualquier escritura: aprobar, editar, enviar, crear, responder.
- Vista para el cliente — el cliente sigue solo en Telegram.
- Multi-entrenador o cualquier vista agregada entre entrenadores (SPEC-034).
- Notificaciones propias del panel (push, email). Las notificaciones siguen
  siendo Telegram.
- Generar o tocar datos de ningún tipo: es un espejo, no una entrada.

## 5. Contratos (boceto, no definitivo)

```
GET /clientes                 → lista con estado y último movimiento
GET /clientes/:clientId       → rutina vigente + histórico + check-ins
GET /clientes/:clientId/checkins → serie temporal para graficar tendencia
```

Cada ruta exige la sesión del entrenador y filtra por `trainer_id`, con la
misma regla que ya aplica `authorization.ts` del lado de Telegram — no una
reescrita, una llamada a la misma función.

## 6. Preguntas abiertas para cuando se decida construir

- ¿Hosting? Al ser solo lectura y sin websockets, un framework simple
  (server-rendered, sin estado) alcanza — no hace falta decidir esto ahora.
- ¿Paginar carteras grandes, o la cartera típica nunca pasa de un par de
  pantallas?
- ¿El Telegram Login Widget exige que el bot tenga dominio propio
  configurado en BotFather? Confirmar antes de prometerlo.

## 7. Por qué esto es V2 y no V1

CLAUDE.md lo dice explícito: "Dashboard web · Frontend" están en la lista de
qué no construir en V1. La razón de fondo, ya anotada en `ROADMAP.md`:
**nada de lo que hay que aprender de los primeros dos meses de uso real se
aprende más rápido teniendo un panel.** El riesgo real del proyecto hoy no es
la falta de una vista agregada — es si el flujo completo (evaluación → IA o
plantilla → aprobación → entrega → check-in) funciona con clientes de
verdad. Un panel antes de eso es resolver un problema que todavía no se
tiene.
