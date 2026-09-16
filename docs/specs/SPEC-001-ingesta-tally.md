# SPEC-001 — Ingesta del formulario de Tally

| Campo | Valor |
|---|---|
| **Estado** | **PARCIAL** — validación del dominio (S-12) |

## Resultado parcial

| Capa | ¿Depende del formato de Tally? | Estado |
|---|---|---|
| Validación de valores del dominio | ❌ No | ✅ S-12, 60 tests, cobertura 100% |
| Mapeo etiqueta → campo | ⚠️ Solo las etiquetas | ✅ S-12, 30 tests. Faltan las etiquetas reales |
| Lectura del sobre de Tally | ✅ **Sí** | ⏸️ **Espera un payload real** |
| Webhook, firma, idempotencia | — | ⏳ S-13, S-14 |

> **Por qué las dos capas de abajo están paradas.** Para las preguntas de
> selección, Tally puede enviar el **ID de la opción** en `value` y las
> etiquetas en otro campo. Escribir el parser suponiendo que `value` trae el
> texto produciría código que compila, pasa los tests y falla con el primer
> cliente real. Es el riesgo **R-08**, y la sección 3 de esta spec ya lo dice:
> *"antes de codificar el parser hay que capturar un payload real"*.
>
> `validateAssessment` no depende de eso, así que se implementó igual.
>
> **El mapeo también se implementó**, manejando el desconocido en vez de
> suponerlo: si el valor de una selección coincide con el `id` de una opción,
> se resuelve a su texto; si no, se usa tal cual. Los dos casos tienen test.
> Lo único que falta ahí es rellenar las etiquetas reales del formulario, que
> es configuración de dos minutos.

### El mapeo es configuración, no código

```typescript
const MAPPING: FieldMapping = {
  fullName: { label: 'Nombre completo' },
  level:    { label: 'Nivel de experiencia' },
  hasLimitations: {
    label: '¿Tienes alguna lesión o limitación?',
    trueWhen: ['Sí', 'Si', 'Yes'],
  },
  // ...
};
```

Cambiar el texto de una pregunta en el formulario es cambiar una línea aquí,
no tocar el parser. La comparación ignora mayúsculas, acentos y espacios
sobrantes, porque el texto de una pregunta se edita y eso no puede romper la
ingesta de todos los clientes.
| **Depende de** | SPEC-000 |
| **Sesiones** | S-12, S-13, S-14 |

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

## 3. Contratos

### Entrada

`POST /functions/v1/tally-webhook`

Cabeceras relevantes: la de firma de Tally.
Cuerpo: JSON de Tally con `eventId`, `eventType`, `createdAt` y `data.fields[]`.

> **Nota de implementación:** antes de codificar el parser hay que capturar
> un payload real del formulario y guardarlo en
> `tests/fixtures/tally-payload.json`. El parser se escribe contra ese
> fixture, no contra suposiciones.

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
  email: string | null;
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

export type ParseResult =
  | { ok: true; value: ParsedAssessment }
  | { ok: false; errors: string[] };
```

## 4. Reglas de negocio

1. **La firma se verifica antes que nada.** Sin firma válida no se toca la
   base de datos.
2. **Idempotencia:** se inserta `webhook_events (source='tally', external_id=eventId)`.
   Si viola unicidad, el evento ya se procesó: responder `200` y salir sin
   ningún efecto adicional.
3. `raw_payload` se guarda íntegro **siempre**, incluso si el parsing falla.
4. La identidad del cliente se resuelve por email; si no hay email, por nombre
   completo. Si existe, se reutiliza; si no, se crea.
5. Un cliente existente conserva su `link_token` y su `telegram_chat_id`.
   Una reevaluación no rompe la vinculación.
6. `link_token`: 32 bytes de CSPRNG en base64url. Máximo 64 caracteres
   (límite del `/start` de Telegram).
7. Se crea un `workout_plan` y, con `create_workout_version`, su primera
   versión en estado `NEW` con `source='ai'` y `content` en NULL.
8. **La respuesta se envía antes de invocar la generación.** El webhook nunca
   espera a Gemini.
9. Si el parsing falla, el evento queda guardado y el entrenador recibe un
   aviso. No se pierde el dato.

## 5. Estados

```
(nada) ──► NEW
```

Registra una fila en `plan_events` con `from_state = NULL`,
`to_state = 'NEW'`, `actor = 'system'`.

## 6. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Firma ausente o inválida | `401` | Nada. Se loguea el intento sin el cuerpo |
| `eventId` duplicado | `200` | Ninguno (idempotencia) |
| JSON inválido | `400` | Nada |
| Campo obligatorio faltante | `200` | Se guarda `raw_payload`, se avisa al entrenador |
| Falla la base de datos | `500` | Tally reintenta; la idempotencia lo cubre |
| Falla el disparo de generación | `200` | El plan queda en `NEW`; lo recoge el reintento |

## 7. Seguridad

- Firma HMAC con comparación de tiempo constante.
- `limitations_detail` **nunca** se escribe en logs.
- El `link_token` nunca aparece en logs ni en mensajes de error.
- Límite de tamaño del cuerpo: 1 MB.
- Longitud máxima de todo campo de texto libre: 2000 caracteres, truncado.

## 8. Criterios de aceptación

- **CA-1** — DADO un payload con firma válida de un cliente nuevo, CUANDO
  llega al webhook, ENTONCES se crean un `client`, un `assessment` y un
  `workout_plan` en `NEW`, y la respuesta es `200` en menos de 1 segundo.
- **CA-2** — DADO un payload ya procesado, CUANDO llega por segunda vez,
  ENTONCES la respuesta es `200` y **no** se crea ninguna fila nueva.
- **CA-3** — DADO un payload con firma inválida, CUANDO llega, ENTONCES la
  respuesta es `401` y no hay ninguna escritura en base de datos.
- **CA-4** — DADO un cliente que ya existe por email, CUANDO envía una segunda
  evaluación, ENTONCES se crea un `assessment` nuevo y el `client` conserva su
  `link_token` y su `telegram_chat_id`.
- **CA-5** — DADO un payload al que le falta `days_per_week`, CUANDO llega,
  ENTONCES `raw_payload` se guarda, no se crea plan y el entrenador recibe
  un aviso.
- **CA-6** — DADO un payload válido, CUANDO se procesa, ENTONCES
  `plan_events` contiene exactamente una fila `NULL → NEW`.
- **CA-7** — DADO cualquier procesamiento, CUANDO se revisan los logs,
  ENTONCES no aparece `limitations_detail` ni `link_token`.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `parseTallyPayload` con el fixture completo |
| Unit | Campo faltante → `{ ok: false, errors }` |
| Unit | `days_per_week = 9` → error de validación |
| Unit | Campo desconocido en el payload → se ignora sin romper |
| Unit | `verifySignature` acepta la firma correcta y rechaza la incorrecta |
| Unit | `generateLinkToken` produce valores únicos de ≤ 64 caracteres |
| Integration | CA-1, CA-2, CA-3, CA-4 contra Supabase local |
| E2E | Paso 1–2 del camino crítico |

## 10. Archivos que toca

```
supabase/functions/_core/tally-parser.ts
supabase/functions/_core/tally-parser.test.ts
supabase/functions/_core/link-token.ts
supabase/functions/_shared/signature.ts
supabase/functions/_shared/db.ts
supabase/functions/tally-webhook/index.ts
tests/fixtures/tally-payload.json
```
