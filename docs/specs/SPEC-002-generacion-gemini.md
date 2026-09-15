# SPEC-002 — Generación de rutina con Gemini

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-000, SPEC-001 |
| **Sesiones** | S-08, S-09, S-16 |

## 1. Objetivo

Convertir una evaluación guardada en un borrador de rutina estructurado y
validado, respetando el límite de uso de Gemini y degradando de forma
controlada cuando no hay margen o la llamada falla.

## 2. Alcance

**Incluye:** chequeo de rate limit, construcción del prompt, llamada a Gemini
con salida estructurada, validación de la respuesta, registro en `ai_usage`,
transición de estados, ruta de degradación.

**No incluye:** enviar el mensaje a Telegram (SPEC-003), reeditar (SPEC-004).

## 3. Contratos

### Entrada

`POST /functions/v1/generate-plan` con `{ planId: string }`.
Invocación interna únicamente (requiere `service_role`).

### Salida

`202` siempre que el plan exista. El resultado se refleja en el estado del plan.

### Tipos

```typescript
export interface Exercise {
  name: string;
  sets: number;
  reps: string;        // "8-10" o "12"
  restSeconds: number;
  notes: string | null;
}

export interface TrainingDay {
  day: number;         // 1..7
  focus: string;
  exercises: Exercise[];
}

export interface WorkoutContent {
  summary: string;
  daysPerWeek: number;
  days: TrainingDay[];
  warnings: string[];  // limitaciones tenidas en cuenta
}

export type GenerationResult =
  | { ok: true; content: WorkoutContent; usage: TokenUsage }
  | { ok: false; reason: 'RATE_LIMITED' | 'API_ERROR' | 'INVALID_OUTPUT'; detail: string };
```

## 4. Reglas de negocio

1. **Se consulta el rate limit antes de llamar a Gemini.** Sin margen en la
   ventana, no se llama.
2. Los límites (peticiones por minuto y por día) viven en configuración, no
   hardcodeados. El proveedor los cambia.
3. El chequeo es `COUNT(*) FROM ai_usage WHERE created_at > now() - ventana`.
   **No es un saldo que se resta.**
4. El prompt incluye siempre las limitaciones del cliente de forma explícita.
5. Se usa salida estructurada (JSON schema) de Gemini.
6. **La respuesta se valida contra el esquema antes de guardarse.** Nunca se
   confía en que Gemini devolvió JSON correcto.
7. Validaciones semánticas obligatorias: el número de días coincide con lo
   pedido; cada día tiene al menos un ejercicio; `sets` entre 1 y 10.
8. Toda llamada se registra en `ai_usage`, **haya fallado o no**.
9. Timeout de 45 segundos. Un reintento como máximo, solo ante error de red
   o `5xx`. Nunca se reintenta un `429`.
10. **Gemini no puede cambiar ningún estado.** Los estados los mueve la
    máquina de estados invocada por el código.

## 5. Estados

```
NEW ──► GENERATING ──┬──► DRAFT ──► TRAINER_REVIEW
                     ├──► FAILED    (error de API o salida inválida)
                     └──► MANUAL    (sin margen de cuota)
```

Cada transición escribe en `plan_events`.

## 6. Errores

| Situación | Estado final | Efecto |
|---|---|---|
| Sin margen de cuota | `MANUAL` | Aviso al entrenador: créala a mano |
| Gemini `429` | `MANUAL` | Igual que arriba. Sin reintento |
| Gemini `5xx` o timeout | `FAILED` tras 1 reintento | Aviso con opción de reintentar |
| JSON inválido | `FAILED` | Se guarda el crudo en `failure_reason` |
| Días ≠ los pedidos | `FAILED` | Motivo explícito |
| Plan no existe | — | `404` |
| Plan no está en `NEW` | — | `200`, no se hace nada (idempotencia) |

**En ningún caso el sistema queda bloqueado.** El entrenador siempre puede
seguir trabajando.

## 7. Seguridad

- `GEMINI_API_KEY` solo desde secretos de Supabase.
- La función solo acepta invocación con `service_role`.
- El prompt enviado a Gemini **no se loguea** (contiene datos de salud).
- Se registran metadatos de `ai_usage`: tokens, latencia, éxito. Nunca contenido.
- El texto libre del cliente es entrada no confiable. La mitigación real es
  la revisión humana obligatoria (SPEC-003).

## 8. Criterios de aceptación

- **CA-1** — DADO un plan en `NEW` y margen de cuota, CUANDO se genera,
  ENTONCES el plan queda en `TRAINER_REVIEW` con `content` válido.
- **CA-2** — DADO que la ventana de cuota está llena, CUANDO se solicita
  generar, ENTONCES **no se llama a Gemini**, el plan queda en `MANUAL` y el
  entrenador recibe el aviso.
- **CA-3** — DADO que Gemini devuelve JSON inválido, CUANDO se procesa,
  ENTONCES el plan queda en `FAILED` con motivo, y `ai_usage` registra
  `success = false`.
- **CA-4** — DADO que el cliente pidió 4 días y Gemini devolvió 3, CUANDO se
  valida, ENTONCES se rechaza y el plan queda en `FAILED`.
- **CA-5** — DADO un cliente con una limitación de hombro, CUANDO se genera,
  ENTONCES `warnings` menciona la limitación.
- **CA-6** — DADO un plan ya en `TRAINER_REVIEW`, CUANDO se vuelve a invocar
  la generación, ENTONCES no se hace nada y no hay llamada a Gemini.
- **CA-7** — DADO cualquier resultado, CUANDO termina, ENTONCES existe
  exactamente una fila en `ai_usage`.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `checkRateLimit`: bajo, en el límite exacto, sobre, ventana expirada |
| Unit | `buildPrompt` incluye las limitaciones |
| Unit | `validateWorkoutContent`: válido, JSON roto, días incorrectos, sets fuera de rango |
| Unit | Máquina de estados: `NEW→GENERATING→DRAFT→TRAINER_REVIEW` válida |
| Unit | Máquina de estados: `NEW→SENT` **rechazada** |
| Integration | CA-1, CA-2, CA-3 con Gemini mockeado |
| E2E | Paso 3 del camino crítico y el escenario de degradación |

## 10. Archivos que toca

```
supabase/functions/_core/state-machine.ts
supabase/functions/_core/state-machine.test.ts
supabase/functions/_core/rate-limit.ts
supabase/functions/_core/rate-limit.test.ts
supabase/functions/_core/prompt-builder.ts
supabase/functions/_core/plan-validator.ts
supabase/functions/_core/plan-validator.test.ts
supabase/functions/_shared/gemini.ts
supabase/functions/generate-plan/index.ts
```
