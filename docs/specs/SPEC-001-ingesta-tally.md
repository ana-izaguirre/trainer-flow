# SPEC-001 — Ingesta del formulario de Tally

| Campo | Valor |
|---|---|
| **Estado** | **PARCIAL** — validación, mapeo y sobre (S-12) |
| **Depende de** | SPEC-000 |
| **Sesiones** | S-12, S-13, S-14 |

## Resultado parcial

| Capa | ¿Depende del formato de Tally? | Estado |
|---|---|---|
| Validación de valores del dominio | ❌ No | ✅ S-12, cobertura 100% |
| Mapeo etiqueta → campo | ⚠️ Solo las etiquetas | ✅ S-12, cobertura 100% |
| Lectura del sobre de Tally | ✅ **Sí** | ✅ S-12, contra un payload real |
| Webhook, firma, idempotencia | — | ⏳ S-13, S-14 |

### El mapeo es configuración, no código

```typescript
const MAPPING: FieldMapping = {
  fullName:       { label: 'Nombre completo' },
  telegramHandle: { label: 'Tu usuario de Telegram' },
  level:          { label: 'Nivel de experiencia' },
  daysPerWeek:    { label: '¿Cuántos días por semana puedes entrenar?', numeric: true },
  sessionMinutes: { label: '¿Cuánto tiempo tienes por sesión?',        numeric: true },
  lifestyle:      { label: '¿Cómo describirías tu día a día?' },
  hasLimitations: {
    label: '¿Tienes alguna lesión o limitación?',
    trueWhen: ['Sí', 'Si', 'Yes'],
  },
};
```

Cambiar el texto de una pregunta en el formulario es cambiar una línea aquí,
no tocar el parser. La comparación ignora mayúsculas, acentos y espacios
sobrantes, porque el texto de una pregunta se edita y eso no puede romper la
ingesta de todos los clientes.

`numeric: true` extrae el primer entero del texto de la opción: `"60 minutos"`
→ `60`, `"3 días"` → `3`. En un rango se toma **el extremo bajo**
(`"45-60 min"` → `45`): prometer menos tiempo del que el cliente tiene es
seguro; prometer más produce una rutina que no cabe en su día.

Si la opción no contiene ningún número, el campo **se omite** y la validación
falla con un error explícito. Es deliberado: una respuesta que no es un tiempo
no puede colarse como si lo fuera.

---

## 1. Objetivo

Cuando un cliente completa el formulario de Tally, su información queda
guardada en la base de datos y el sistema dispara la generación de la rutina,
respondiendo al webhook en menos de un segundo.

## 2. Alcance

**Incluye:** endpoint del webhook, verificación de firma, idempotencia,
parsing del payload, creación de cliente y evaluación, generación del
`link_token`, plan en estado `NEW`, disparo asíncrono de la generación.

**No incluye:** llamar a Gemini (SPEC-002), enviar mensajes (SPEC-003),
vincular al cliente (SPEC-005).

## 3. El formulario

Estas son las preguntas que la ingesta necesita. El formulario puede tener
más; los campos que no estén en el mapeo se ignoran.

| Pregunta | Tipo en Tally | Alimenta |
|---|---|---|
| Nombre completo | Texto | `fullName` |
| **Tu usuario de Telegram** | Texto | `telegramHandle` |
| Objetivo principal | Selección única | `goal` |
| Nivel de experiencia | **Selección única** | `level` |
| Días por semana | Selección única | `daysPerWeek` |
| **Tiempo por sesión** | Selección única | `sessionMinutes` |
| **Cómo describirías tu día a día** | Selección única | `lifestyle` |
| Material disponible | Selección única | `equipment` |
| ¿Alguna lesión o limitación? | Sí / No | `hasLimitations` |
| Detalle de la limitación | Texto largo | `limitationsDetail` |

### Tres correcciones sobre el formulario actual

1. **Tiempo por sesión y estilo de vida son dos preguntas distintas.**
   Hoy las opciones de estilo de vida (`Sedentario`, `Activo`…) están mezcladas
   dentro de la pregunta de tiempo. Son dimensiones sin relación: *cuánto dura
   una sesión* es una restricción de agenda, *cómo es tu día* es contexto para
   el volumen y la recuperación. Mezcladas, ninguna de las dos se puede leer:
   la respuesta `"Sedentario"` no contiene minutos, y el sistema se queda sin
   `sessionMinutes`.

2. **Nivel debe ser selección única, no casillas.** Con casillas un cliente
   puede marcar `Principiante` **y** `Avanzado` a la vez, y no existe una
   respuesta correcta a esa contradicción.

3. **Falta el usuario de Telegram.** Ver la sección 4, regla 4.

## 4. Contratos

### Entrada

`POST /functions/v1/tally-webhook`

Cabeceras relevantes: la de firma de Tally.
Cuerpo: JSON de Tally con `eventId`, `eventType`, `createdAt` y `data.fields[]`.

El parser se escribe contra `tests/fixtures/tally-form-response.json`, que es
un envío **real** del formulario, no un payload inventado.

### Salida

| Código | Cuándo |
|---|---|
| `200` | Procesado correctamente, o duplicado ignorado |
| `401` | Firma inválida |
| `400` | Payload malformado |
| `500` | Error interno |

### Tipos

```typescript
export type Level = 'beginner' | 'intermediate' | 'advanced';

export interface ParsedAssessment {
  fullName: string;
  /** Usuario de Telegram declarado por el cliente. Es una PISTA, no identidad. */
  telegramHandle: string | null;
  goal: string;
  level: Level;
  daysPerWeek: number;      // 1..7
  sessionMinutes: number;   // 15..180
  equipment: string;
  hasLimitations: boolean;
  limitationsDetail: string | null;
  lifestyle: string | null;
  notes: string | null;
}

export type AssessmentResult =
  | { ok: true; value: ParsedAssessment }
  | { ok: false; errors: AssessmentError[] };
```

## 5. Reglas de negocio

1. **La firma se verifica antes que nada.** Sin firma válida no se toca la
   base de datos.
2. **Idempotencia:** se inserta `webhook_events (source='tally', external_id=eventId)`.
   Si viola unicidad, el evento ya se procesó: responder `200` y salir sin
   ningún efecto adicional.
3. `raw_payload` se guarda **siempre**, incluso si el parsing falla, pero
   **sin las URLs de descarga** (`submissionPdfUrl`, `submissionPreviewUrl`):
   llevan una credencial firmada dentro. Ver sección 8.
4. **La identidad del cliente se resuelve por `telegram_handle`; si no hay,
   por nombre completo.** Si existe, se reutiliza; si no, se crea.
5. **El handle del formulario es una pista, nunca una identidad verificada.**
   Lo escribe el cliente: puede equivocarse o poner el de otra persona. No
   otorga acceso a nada. El `telegram_user_id` real solo se obtiene cuando el
   cliente abre el deep link y Telegram firma el update (ADR-006, ADR-009).
   Se guarda porque resuelve el problema que el nombre no resuelve: dos
   clientes llamados «Carlos» dejan de ser el mismo cliente.
6. Un cliente existente conserva su `link_token` y su vínculo. Una
   reevaluación no rompe la vinculación.
7. `link_token`: 32 bytes de CSPRNG en base64url. Máximo 64 caracteres
   (límite del `/start` de Telegram).
8. Se crea un `workout_plan` y, con `create_workout_version`, su primera
   versión en estado `NEW` con `source='ai'` y `content` en NULL.
9. **La respuesta se envía antes de invocar la generación.** El webhook nunca
   espera a Gemini.
10. Si el parsing falla, el evento queda guardado y el entrenador recibe un
    aviso. No se pierde el dato.

### Normalización del handle

Se acepta lo que la gente escribe de verdad y se guarda una sola forma:

| Lo que escribe el cliente | Se guarda |
|---|---|
| `@Carlitos` | `carlitos` |
| `Carlitos` | `carlitos` |
| `t.me/carlitos` | `carlitos` |
| `https://t.me/carlitos` | `carlitos` |
| `123456789` | `123456789` |

Reglas de Telegram: de 5 a 32 caracteres, letras, dígitos y `_`, empezando por
letra. Un ID numérico (5 a 15 dígitos) también se acepta, porque alguna gente
pega ese. Cualquier otra cosa es un error de campo, no una evaluación perdida.

## 6. Estados

```
(nada) ──► NEW
```

Registra una fila en `plan_events` con `from_state = NULL`,
`to_state = 'NEW'`, `actor = 'system'`.

## 7. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Firma ausente o inválida | `401` | Nada. Se loguea el intento sin el cuerpo |
| `eventId` duplicado | `200` | Ninguno (idempotencia) |
| JSON inválido | `400` | Nada |
| Campo obligatorio faltante | `200` | Se guarda `raw_payload`, se avisa al entrenador |
| Falla la base de datos | `500` | Tally reintenta; la idempotencia lo cubre |
| Falla el disparo de generación | `200` | El plan queda en `NEW`; lo recoge el reintento |

## 8. Seguridad

- Firma HMAC con comparación de tiempo constante.
- **Las URLs de descarga de Tally se eliminan antes de persistir.**
  `submissionPdfUrl` y `submissionPreviewUrl` contienen un token firmado que
  da acceso a la respuesta completa, con los datos de salud dentro. Guardarlas
  sería meter una credencial viva en la base de datos.
- `limitations_detail` **nunca** se escribe en logs.
- El `link_token` nunca aparece en logs ni en mensajes de error.
- El `telegram_handle` no autoriza nada. Ver regla 5.
- Límite de tamaño del cuerpo: 1 MB.
- Longitud máxima de todo campo de texto libre: 2000 caracteres, truncado.

## 9. Criterios de aceptación

- **CA-1** — DADO un payload con firma válida de un cliente nuevo, CUANDO
  llega al webhook, ENTONCES se crean un `client`, un `assessment` y un
  `workout_plan` en `NEW`, y la respuesta es `200` en menos de 1 segundo.
- **CA-2** — DADO un payload ya procesado, CUANDO llega por segunda vez,
  ENTONCES la respuesta es `200` y **no** se crea ninguna fila nueva.
- **CA-3** — DADO un payload con firma inválida, CUANDO llega, ENTONCES la
  respuesta es `401` y no hay ninguna escritura en base de datos.
- **CA-4** — DADO un cliente que ya existe con `telegram_handle = 'carlitos'`,
  CUANDO llega una segunda evaluación con `@Carlitos`, ENTONCES se crea un
  `assessment` nuevo y el `client` conserva su `link_token` y su vínculo.
- **CA-5** — DADO un payload al que le falta `days_per_week`, CUANDO llega,
  ENTONCES `raw_payload` se guarda, no se crea plan y el entrenador recibe
  un aviso.
- **CA-6** — DADO un payload válido, CUANDO se procesa, ENTONCES
  `plan_events` contiene exactamente una fila `NULL → NEW`.
- **CA-7** — DADO cualquier procesamiento, CUANDO se revisan los logs,
  ENTONCES no aparece `limitations_detail` ni `link_token`.
- **CA-8** — DADA la pregunta de tiempo por sesión con opciones de texto,
  CUANDO el cliente responde `"60 minutos"`, ENTONCES `sessionMinutes` vale
  `60`; y CUANDO responde algo sin número, ENTONCES la validación falla en
  `sessionMinutes` en vez de inventarse un valor.
- **CA-9** — DADO un payload persistido, CUANDO se lee `raw_payload`,
  ENTONCES no contiene `submissionPdfUrl` ni `submissionPreviewUrl`.

## 10. Tests

| Nivel | Caso |
|---|---|
| Unit | `validateAssessment` con todos los campos, válidos e inválidos |
| Unit | Handle en sus cinco formas → misma forma normalizada |
| Unit | Handle inválido → error de campo, no excepción |
| Unit | `numeric: true` extrae el entero; sin número, omite el campo |
| Unit | `parseTallyEnvelope` contra el fixture real |
| Unit | Campo desconocido en el payload → se ignora sin romper |
| Unit | `verifySignature` acepta la firma correcta y rechaza la incorrecta |
| Unit | `generateLinkToken` produce valores únicos de ≤ 64 caracteres |
| Integration | CA-1 a CA-4, CA-9 contra Postgres |
| E2E | Paso 1–2 del camino crítico |

## 11. Archivos que toca

```
supabase/functions/_core/assessment/validate-assessment.ts
supabase/functions/_core/assessment/field-mapping.ts
supabase/functions/_core/assessment/tally-envelope.ts
supabase/functions/_core/link-token.ts
supabase/functions/_shared/signature.ts
supabase/functions/_shared/db.ts
supabase/functions/tally-webhook/index.ts
supabase/migrations/0004_client_telegram_handle.sql
tests/fixtures/tally-form-response.json
```
