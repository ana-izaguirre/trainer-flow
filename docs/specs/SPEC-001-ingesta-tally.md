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
  fullName:       { label: 'Nombre' },
  goal:           { label: 'Objetivo' },
  level:          { label: 'Nivel', valueMap: {
                      Principiante: 'beginner',
                      Intermedio:   'intermediate',
                      Avanzado:     'advanced',
                    } },
  daysPerWeek:    { label: '¿Cuántos días a la semana entrenas?', numeric: true },
  sessionMinutes: { label: 'Tiempo por sesión',                   numeric: true },
  lifestyle:      { label: 'Estilo de vida' },
  equipment:      { label: 'Equipamiento disponible' },
  hasLimitations: { label: 'Lesiones, dolor o limitaciones', falseWhen: ['Ninguna'] },
  limitationsDetail: { label: 'Cuéntanos brevemente qué debemos tener en cuenta.' },
  notes:          { label: '¿Hay algo más que tu entrenador deba saber?' },
};
```

`falseWhen` lee un sí/no de una lista de casillas: es `true` cuando el cliente
marcó algo que **no** está en la lista de negaciones.

La pregunta de lesiones ofrece `Ninguna` junto a las partes del cuerpo, y Tally
deja marcar las dos cosas. **Ante esa contradicción el resultado es `true`.**
No es una preferencia estética: `hasLimitations` es lo que dispara el aviso de
seguridad de la rutina. Equivocarse hacia el aviso de más no lastima a nadie;
hacia el de menos, sí.

| El cliente marca | `hasLimitations` |
|---|---|
| `Ninguna` | `false` |
| `Rodilla` | `true` |
| `Ninguna` + `Rodilla` | **`true`** |
| nada | `false` |

> ### ⚠️ Sigue abierto: qué parte del cuerpo
>
> Las casillas dicen **dónde** duele (`Rodilla`, `Hombro`), pero hoy solo
> alimentan el booleano. Si el cliente marca `Rodilla` y deja el texto libre
> vacío, `limitationsDetail` queda en `null` y **la IA nunca se entera de que
> es la rodilla**: genera sentadillas con un aviso genérico.
>
> Es el dato más valioso que tenemos para la seguridad y lo estamos tirando.
> Tres salidas, y hay que elegir una antes de S-14:
>
> | | Coste |
> |---|---|
> | **A** · `ParsedAssessment` gana `limitationAreas: string[]` | columna nueva + migración |
> | **B** · Las casillas alimentan también `limitationsDetail` | regla nueva en el mapeo |
> | **C** · En Tally, el texto libre pasa a obligatorio si marcó algo | cero código, pero el dato sigue sin estructurar |

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

`valueMap` traduce el texto de la opción al valor del dominio: el formulario
dice `"Principiante (Menos de 6 meses)"` y el dominio espera `"beginner"`.
**La clave se compara como prefijo**, porque el texto de una opción se edita
igual que el de una pregunta: anclarla al texto completo la haría frágil por
nada. Un texto que no esté en el mapa pasa tal cual, y la validación lo
rechaza nombrando el problema real.

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

3. **«Días a la semana» no debe incluir el `0`.** El dominio acepta de 1 a 7:
   quien marque 0 pierde el envío entero.

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
4. **El formulario es onboarding. Cada envío crea un cliente nuevo.**
   No se resuelve identidad contra los clientes existentes. Ver abajo.
5. **Un cliente que ya está dentro no vuelve al formulario.** Si quiere
   cambiar de objetivo, se lo dice a su entrenador por Telegram y este crea
   una versión nueva. El formulario no es un canal de actualización.
6. `link_token`: 32 bytes de CSPRNG en base64url. Máximo 64 caracteres
   (límite del `/start` de Telegram).
7. Se crea un `workout_plan` y, con `create_workout_version`, su primera
   versión en estado `NEW` con `source='ai'` y `content` en NULL.
8. **La respuesta se envía antes de invocar la generación.** El webhook nunca
   espera a Gemini.
9. Si el parsing falla, el evento queda guardado y el entrenador recibe un
    aviso. No se pierde el dato.

### Por qué no se resuelve la identidad

Hay tres formas de tratar un segundo envío, y solo una es segura:

| Cómo | ¿Duplicados? | ¿Riesgo? |
|---|---|---|
| Por un usuario declarado en el formulario | No | Un typo invalida el envío entero |
| **Por nombre completo** | No | 🔴 **Fusiona a dos personas distintas** |
| **No resolver nada** | Sí, pero **visibles** | Ninguno |

Resolver por nombre metería la lesión de un «Carlos Pérez» en la rutina de
otro, y **sin que nadie se entere**. Un duplicado se ve en la lista y se borra
en treinta segundos; una fusión silenciosa no se ve nunca.

Con un entrenador y diez clientes, un segundo envío es una anomalía, no un
flujo. No se optimiza para él.

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
- **CA-4** — DADOS dos envíos del formulario con el mismo `full_name`, CUANDO
  se procesan, ENTONCES existen **dos clientes distintos**, cada uno con su
  `link_token`. Ninguno pisa al otro.
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
- **CA-9** — DADA la opción `"Principiante (Menos de 6 meses)"`, CUANDO se
  mapea, ENTONCES `level` vale `"beginner"`; y CUANDO alguien edita el
  paréntesis de la opción, ENTONCES **sigue valiendo `"beginner"`**.
- **CA-10** — DADO un cliente que marca `Ninguna` **y** `Rodilla`, CUANDO se
  mapea, ENTONCES `hasLimitations` es `true`. Ante la contradicción, se avisa.
- **CA-11** — DADO un payload persistido, CUANDO se lee `raw_payload`,
  ENTONCES no contiene `submissionPdfUrl` ni `submissionPreviewUrl`.

## 10. Tests

| Nivel | Caso |
|---|---|
| Unit | `validateAssessment` con todos los campos, válidos e inválidos |
| Unit | `numeric: true` extrae el entero; sin número, omite el campo |
| Unit | `valueMap` traduce por prefijo; sin coincidencia, pasa tal cual |
| Unit | `falseWhen`: solo negaciones → `false`; una marca fuera → `true` |
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
supabase/migrations/0005_drop_client_telegram_handle.sql
tests/fixtures/tally-form-response.json
```
