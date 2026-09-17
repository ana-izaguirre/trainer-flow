# SPEC-002 — Generación con IA

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** (S-15 → S-18) |
| **Depende de** | SPEC-000, SPEC-008 |
| **Sesiones** | S-15, S-16, S-17, S-18 |

> **Depende de SPEC-008 a propósito.** El camino manual se construye **antes**
> que la IA. Así el producto ya funciona cuando se añade la IA, y no al revés.

## 1. Objetivo

Convertir una evaluación en un borrador de rutina usando un proveedor de IA
intercambiable, validando estrictamente su respuesta y degradando de forma
controlada cuando falla o no hay margen de cuota.

## 2. Alcance

**Incluye:** la interfaz `AIProvider`, la implementación de Gemini en
`_shared`, rate limit, validación del draft, registro en `ai_generations`,
degradación hacia plantilla o manual.

**No incluye:** un segundo proveedor (§21, solo queda preparado), el envío por
Telegram (SPEC-003).

## 3. Contratos

### La interfaz vive en el core, la implementación fuera

```typescript
// _core/ports/ai-provider.ts — CERO dependencias.
// La palabra "Gemini" NO aparece en este archivo ni en ningún otro de _core.
export interface AIRequest {
  readonly goal: string;
  readonly level: Level;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  readonly limitations: string | null;
  readonly instruction: string | null;   // para editar una versión existente
}

export type AIFailureReason =
  | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'INVALID_OUTPUT';

export type AIResult =
  | { ok: true; draft: WorkoutDraft; usage: TokenUsage }
  | { ok: false; reason: AIFailureReason; detail: string };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generate(request: AIRequest, signal: AbortSignal): Promise<AIResult>;
}
```

```
_core/ports/ai-provider.ts      ← la interfaz. El dominio solo conoce esto
_shared/ai/gemini-provider.ts   ← implementación. Aquí vive GEMINI_API_KEY
```

**Añadir otro proveedor es un archivo nuevo en `_shared/`.** Ni una línea de
`_core` cambia. Eso es el punto §2.

### Entrada

`POST /functions/v1/generate-version` con `{ versionId, requestId }`.
Invocación interna, requiere `service_role`.

### Salida

`202` si la versión existe. El resultado se ve en su estado.

## 4. Reglas de negocio

1. **Se consulta el rate limit antes de llamar al proveedor.** Sin margen, no se
   llama.
2. El chequeo es `COUNT(*) FROM ai_generations WHERE created_at > now() - ventana`.
   **Es una ventana, no un saldo.** Los límites viven en configuración.
3. Se inserta `ai_generations` en `GENERATING` **antes** de llamar, y se cierra
   con `SUCCEEDED` o `FAILED`. Toda llamada queda registrada.
4. El prompt incluye siempre las limitaciones del cliente, de forma explícita.
5. Se usa salida estructurada (JSON schema) del proveedor.
6. **La respuesta se valida con `validateDraft` antes de guardarse.** Nunca se
   confía en que devolvió JSON correcto. `WorkoutDraft.raw` es `unknown`.
7. Validaciones semánticas: los días coinciden con lo pedido; cada día tiene al
   menos un ejercicio; `sets` 1..10; `restSeconds` 0..600.
8. Timeout de 45 segundos. Un reintento como máximo, solo ante error de red o
   `5xx`. **Nunca se reintenta un `429`.**
9. **La IA no cambia estados.** Los mueve la máquina de estados desde el código.
10. **La IA no escribe en la base de datos.** Devuelve un draft; el código
    valida y persiste.

## 5. Estados

```
NEW ── GENERATE ──► GENERATING ──┬── GENERATION_SUCCEEDED ──► DRAFT
                                 └── GENERATION_FAILED ─────► NEW
```

**Un fallo devuelve la versión a `NEW`**, no la mata. El entrenador recibe el
aviso y sigue por plantilla o manual (SPEC-008) sobre la misma versión.

El motivo del fallo vive en `ai_generations.failure_reason`, **fuera del enum
del dominio**.

## 6. Errores

| Situación | Estado final | Efecto |
|---|---|---|
| Sin margen de cuota | `NEW` | No se llama. Aviso: usa plantilla o manual |
| `429` del proveedor | `NEW` | Sin reintento. Mismo aviso |
| `5xx` o timeout | `NEW` tras 1 reintento | Aviso con opción de reintentar |
| JSON inválido | `NEW` | `failure_reason = 'INVALID_OUTPUT'` |
| Días ≠ los pedidos | `NEW` | `failure_reason = 'INVALID_OUTPUT'` |
| La versión no existe | — | `404` |
| La versión no está en `NEW` | — | `200`, sin hacer nada (idempotencia) |

**En ningún caso el sistema queda bloqueado.** Siempre hay camino manual.

## 7. Seguridad

- `GEMINI_API_KEY` solo en `_shared/ai/gemini-provider.ts`, desde secretos.
- La función solo acepta invocación con `service_role`.
- **El prompt no se loguea** (contiene datos de salud). Sí sus metadatos:
  tokens, latencia, resultado.
- La respuesta es **dato no confiable**: se valida siempre, nunca se ejecuta.
- **Prompt injection:** el texto libre del cliente llega al prompt. El peor
  resultado posible es un borrador malo, que el entrenador revisa antes de
  aprobar. La revisión humana es también el control de seguridad.

## 8. Criterios de aceptación

- **CA-1** — DADO una versión en `NEW` y margen de cuota, CUANDO se genera,
  ENTONCES queda en `DRAFT` con contenido válido.
- **CA-2** — DADO la ventana de cuota llena, CUANDO se solicita, ENTONCES **no
  se llama al proveedor**, la versión sigue en `NEW` y el entrenador recibe el
  aviso con la alternativa.
- **CA-3** — DADO que el proveedor devuelve JSON inválido, CUANDO se procesa,
  ENTONCES la versión vuelve a `NEW` y `ai_generations` registra `FAILED` con
  `INVALID_OUTPUT`.
- **CA-4** — DADO que se pidieron 4 días y llegaron 3, CUANDO se valida,
  ENTONCES se rechaza.
- **CA-5** — DADO un cliente con limitación de hombro, CUANDO se genera,
  ENTONCES `warnings` menciona la limitación.
- **CA-6** — DADO una versión ya en `DRAFT`, CUANDO se reinvoca la generación,
  ENTONCES no se llama al proveedor.
- **CA-7** — DADO cualquier resultado, CUANDO termina, ENTONCES existe una fila
  en `ai_generations` con su estado final y su latencia.
- **CA-8** — DADO el código de `_core`, CUANDO se busca "gemini" sin distinguir
  mayúsculas, ENTONCES **no aparece ninguna coincidencia**.
- **CA-9** — DADO un proveedor de prueba que implementa `AIProvider`, CUANDO se
  inyecta, ENTONCES todo funciona sin tocar `_core`.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `checkRateLimit`: bajo, en el límite exacto, sobre, ventana expirada |
| Unit | `buildPrompt` incluye las limitaciones |
| Unit | `validateDraft`: válido, JSON roto, días incorrectos, sets fuera de rango |
| Unit | **CA-8**: un test que hace grep sobre `_core` buscando el proveedor |
| Unit | `AIProvider` falso: éxito, `429`, timeout, salida inválida |
| Integration | CA-1 a CA-3, CA-6, CA-7 con el proveedor mockeado |
| **E2E-2** | IA: generar → validar → editar → aprobar → enviar |
| **E2E-3** | Fallo: `429` → aviso → plantilla → publicar |

## 10. Archivos

```
supabase/functions/_core/ports/ai-provider.ts
supabase/functions/_core/domain/validate-draft.ts
supabase/functions/_core/ai/prompt-builder.ts
supabase/functions/_core/ai/prompt-builder.test.ts
supabase/functions/_core/ai/rate-limit.ts
supabase/functions/_core/ai/rate-limit.test.ts
supabase/functions/_shared/ai/gemini-provider.ts
supabase/functions/generate-version/index.ts
```
