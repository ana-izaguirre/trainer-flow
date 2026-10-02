# SPEC-036 — Formulario propio de admisión (reemplaza Tally)

| Campo | Valor |
|---|---|
| **Estado** | **BORRADOR — parcialmente bloqueada por SPEC-034** (ver §2). Lo que no depende de esa spec ya está diseñado (§3); lo que sí depende, espera (§4) |
| **Depende de** | SPEC-001 (ingesta actual vía Tally), SPEC-015 (ficha de admisión), **SPEC-034 (multi-entrenador, sin resolver)** |
| **Sesiones** | Por asignar |

## 1. Objetivo

Reemplazar Tally por un formulario propio, con experiencia conversacional
— una pregunta a la vez, estilo Typeform — que cada entrenador pueda
personalizar: su logo, qué preguntas mostrar, preguntas propias agregadas.

## 2. Por qué esta spec no se puede cerrar sola

"Cada entrenador tiene su propio formulario, con su logo y sus preguntas"
da por hecho algo que el sistema hoy no decide: **cómo se distingue a un
entrenador de otro cuando alguien llena un formulario**, y eso es
exactamente la pregunta #1 que SPEC-034 dejó abierta a propósito —
*¿entrenadores totalmente independientes, o un equipo/estudio?*

No se puede diseñar "formulario por entrenador" sin esa respuesta: si son
independientes, cada uno tiene su propia URL/slug y configuración, sin
relación entre ellos — chico. Si es un estudio, hace falta saber quién
puede editar el formulario de quién, y eso es una superficie de permisos
que hoy no existe.

**El pedido de hoy es, en sí mismo, una señal hacia "independientes":** no
se mencionó que un dueño de estudio gestione formularios ajenos, ni
compartir preguntas entre entrenadores — cada uno es dueño del suyo. Si eso
es correcto, destraba la pregunta #1 de SPEC-034 también, no solo esta
spec. Lo propongo en §5, pero no lo asumo unilateralmente: es una decisión
de negocio, igual que dice SPEC-034 §3.

## 3. Lo que ya se puede diseñar, sin esperar a SPEC-034

### 3.1 Catálogo de preguntas: obligatorias vs. configurables

Las preguntas de SPEC-001/SPEC-015 (`goal`, `level`, `days_per_week`,
`session_minutes`, `equipment`, `limitations`, …) se dividen en dos grupos:

- **Obligatorias, no se pueden quitar.** Las que el dominio necesita para
  generar o templar una rutina (`domain/assessment.ts`,
  `validate-draft.ts`) — sin `level` o `days_per_week`, ni la IA ni una
  plantilla tienen con qué trabajar. Ocultarlas rompería el mismo
  principio que protege `validateDraft`: nada entra al dominio sin pasar
  la validación completa.
- **Configurables, el entrenador decide.** El resto (`menopause_stage`,
  `chronic_conditions`, …): preguntas reales del dominio, pero que un
  entrenador puede no necesitar para su público.

**Preguntas custom (texto libre del entrenador) quedan fuera del dominio
tipado** — se guardan como texto en `notes` (ya existe, SPEC-015), nunca
generan un campo nuevo en `assessments`. La alternativa — que una pregunta
custom condicione la plantilla o el prompt de la IA — es un cambio de
dominio mucho más grande, y no entra en esta spec salvo que Ana lo pida
explícitamente (§5, pregunta 3).

### 3.2 La experiencia: una pregunta a la vez, estilo Typeform

- Una pregunta visible por pantalla, con barra de progreso, transición
  (Motion) al avanzar — nunca decorativa: la animación es la única señal
  de que la respuesta se guardó y se avanzó.
- Mobile-first: es el mismo público que hoy completa el formulario de
  Tally desde el celular.
- Validación inline, por pregunta — no al final: un error en la pregunta 3
  de 12 se corrige ahí, no vuelve a repetir las primeras 11.
- Accesible igual que el panel (SPEC-033 §3.5): navegable por teclado,
  cada pregunta con su `label`, foco visible — es la puerta de entrada de
  un cliente nuevo, no puede ser menos accesible que el resto.

### 3.3 Reemplazar Tally: mismo patrón de ingesta, otro origen

Hoy `tally-webhook` recibe un payload firmado y lo mapea a `assessments`
(SPEC-001). El form propio no cambia ESE contrato de salida — sigue
`recibir → guardar → responder → disparar aparte` (CLAUDE.md) — cambia
solo el origen: en vez de una firma HMAC de Tally, es el propio formulario
(mismo origen, mismo dominio) el que postea a una función equivalente.
Dejar Tally como respaldo durante la transición, o cortar de una vez, se
decide al implementar — no cambia el diseño.

## 4. Lo que espera a SPEC-034 — no se diseña en detalle aquí

- **Cómo se llega al formulario de UN entrenador.** Slug en la URL
  (`trainerflow.app/f/<slug>`), subdominio, o algo que dependa del modelo
  de "estudio" si ese resultara ser el camino — no se elige sin la
  respuesta de §5.
- **Dónde vive la configuración por entrenador.** El patrón ya existe en
  todo el esquema (`trainer_id` en cada tabla, SPEC-034 §2) — una tabla
  `trainer_form_config` (logo, preguntas habilitadas, preguntas custom) es
  barata de construir una vez resuelta la pregunta #1. Construirla antes
  sería adivinar la forma, no solo el contenido.
- **El logo**: subir un archivo pide Supabase Storage, una pieza que hoy
  el proyecto no usa — o una URL pegada, que no pide nada nuevo. Se
  resuelve en la pregunta 2 de §5, no bloquea el resto del diseño.

## 5. Preguntas para Ana (bloqueantes, antes de implementar)

| Pregunta | Por qué importa |
|---|---|
| **1. ¿Confirmás "independientes"** — cada entrenador con su propio slug/URL y configuración, sin relación entre ellos — **para SPEC-034 también**, no solo para esta spec? | Si es que sí, destraba el diseño completo de ambas specs de una vez. Si la respuesta es "no, hay un estudio por encima", el diseño de §4 cambia entero. |
| **2. El logo: ¿archivo subido o URL pegada?** | Archivo pide Supabase Storage (pieza nueva); URL no pide nada — mismo patrón que `TALLY_FORM_URL` hoy. |
| **3. Las preguntas custom: ¿solo texto libre (a `notes`), o alguna debería poder influir la plantilla o el prompt de la IA?** | Texto libre es chico y seguro (§3.1). Influir la generación es un cambio de dominio mayor — nueva spec aparte si la respuesta es sí. |

## 6. Alcance tentativo (se cierra tras §5)

**Ya decidido, no depende de la respuesta:**
- Catálogo de preguntas obligatorias vs. configurables (§3.1).
- Experiencia conversacional, accesible, mobile-first (§3.2).
- El mismo contrato de ingesta que Tally, otro origen (§3.3).

**Pendiente de §5:**
- Identificación del entrenador dueño del formulario.
- Modelo de datos de la configuración por entrenador.
- Subida de logo (si aplica).
- Si las preguntas custom tocan el dominio o quedan en texto libre.

## 7. Qué no cambia, decida lo que decida esto

- Los dos principios no negociables (CLAUDE.md) no se tocan: el formulario
  solo ingesta datos, igual que Tally hoy — no decide nada, no genera nada.
- `validateDraft` sigue siendo la única puerta de entrada al dominio: una
  pregunta custom nunca se cuela como campo tipado sin pasar por ahí.
- El cliente sigue recibiendo todo por Telegram — este formulario es el
  *de admisión* (antes de ser cliente), no reemplaza `/actualizar_datos`
  ni ninguna otra superficie ya resuelta por Telegram.
