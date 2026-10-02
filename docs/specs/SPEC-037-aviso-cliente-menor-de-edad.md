# SPEC-037 — Aviso de cliente menor de edad

| Campo | Valor |
|---|---|
| **Estado** | **APROBADA** — decisiones de diseño confirmadas por Ana (octubre 2026) |
| **Depende de** | SPEC-001, SPEC-005, SPEC-016 |
| **Sesiones** | Por asignar |
| **Origen** | Pedido de Ana en testing real: "¿cómo tiro un error que el user vea si es menor de edad, diciendo que mostrará la rutina pero que necesita consentimiento del padre?" |

## 1. Objetivo

Que el entrenador y el cliente se enteren, sin que nadie tenga que calcularlo a mano, cuando una evaluación es de un menor de edad — para que el entrenador gestione el consentimiento de un padre o tutor por su cuenta. El sistema **nunca bloquea nada**: solo avisa.

## 2. El problema

Hoy el sistema acepta evaluaciones desde los 10 años (`ASSESSMENT_LIMITS.age`, SPEC-016) y no distingue en ningún lado si un cliente es menor de edad. No hay ningún aviso, ni al entrenador ni al cliente — la responsabilidad de notarlo recae enteramente en que el entrenador se dé cuenta leyendo el dato a mano en la ficha.

## 3. Decisiones ya tomadas por Ana

| # | Decisión | Resuelto |
|---|---|---|
| **D1** | ¿Bloquea el envío de la rutina, o solo avisa? | **Solo avisa.** El entrenador arma y envía la rutina igual; la gestión del consentimiento queda fuera del sistema. |
| **D2** | ¿Cómo se calcula la edad? | **`birthDate` con fallback a `age`** — mismo criterio que ya usa `version_for_generation` (migración 0021) para mostrarle la edad al entrenador. Menor = esa edad calculada es menor a 18 años. |
| **D3** | ¿El cliente también ve algo distinto? | **Sí**, además del aviso al entrenador. |

Quedó descartada, por decisión explícita, la alternativa de pedir el consentimiento como paso dentro del formulario (más robusta legalmente, pero depende de rediseñar Tally y de SPEC-036, que todavía no está resuelta).

## 4. Alcance

**Incluye:**
- Una función en `_core` que determine si una evaluación es de un menor, con el mismo criterio de cálculo de edad que ya usa la base.
- Una línea de aviso en la notificación de evaluación nueva, al entrenador (`buildAssessmentArrived`, `_core/telegram/notify.ts`).
- Una línea en el primer mensaje que recibe el cliente con su rutina (`_core/telegram/delivery.ts`), **solo en la primera entrega** — no se repite en cada revisión, igual filosofía que SPEC-030 regla 10 (la v2 en adelante se presenta como «actualizada», no como una bienvenida otra vez).

**No incluye:**
- Bloquear `APPROVED → SENT` ni ningún otro estado (D1).
- Pedir el contacto de un padre/tutor, ni guardarlo en ningún lado.
- Registrar o verificar que el consentimiento se obtuvo de verdad: es responsabilidad del entrenador, fuera del sistema.
- Cambiar el formulario de Tally (D1, descartado en §3).

## 5. Contratos

### Entrada

La misma evaluación ya validada por `validateAssessment` (SPEC-001/SPEC-016): `age: number | null`, `birthDate: string | null` (ISO `AAAA-MM-DD`). Nada nuevo que pedirle a Tally.

### Salida

```typescript
// _core/assessment/minor.ts

/**
 * `birthDate` gana si está: es la edad exacta. Si no, cae a `age`
 * (declarada, SPEC-016). Sin ninguno de los dos, no hay base para
 * afirmar nada — nunca "es menor" sin evidencia.
 */
export function isMinorClient(
  input: { readonly age: number | null; readonly birthDate: string | null },
  today: Date,
): boolean;
```

`today` entra por parámetro, no `new Date()` dentro de la función: el mismo patrón que `ChangeRequestDeps.now` (`change-request/flows.ts`) — testeable sin mockear el reloj global, y el borde de "17 vs. 18 años" sí es sensible al día exacto (a diferencia del rango amplio de `validate-assessment.ts`, aquí un día de diferencia cambia el resultado).

### Tipos que se extienden

```typescript
// _core/telegram/notify.ts
export interface AssessmentSummary {
  // ... los campos que ya existen
  readonly isMinor: boolean;
}

// _core/ports/delivery-ports.ts
export interface VersionForDelivery {
  // ... los campos que ya existen
  readonly clientIsMinor: boolean;
}
```

Ninguno de los dos lleva `birthDate` ni `age` crudos — igual que `hasLimitations` ya viaja como booleano y no como el detalle de salud, el dato sensible se calcula una vez y solo se propaga el resultado.

## 6. Reglas de negocio

1. **El sistema nunca bloquea nada por ser menor** (D1). `isMinorClient` no participa en `validateDraft`, en `canManageClient` ni en ninguna transición de estado.
2. **Sin dato de edad, no se afirma nada.** Si `age` y `birthDate` son ambos `null`, `isMinorClient` devuelve `false` — ausencia de evidencia no es evidencia de que sea menor, y un falso aviso le genera trabajo al entrenador sin motivo.
3. **El aviso al entrenador va en la notificación de evaluación nueva**, nunca en la ficha como un campo aparte: es información que importa en el momento de decidir si armar la rutina, no un dato de consulta permanente.
4. **El aviso al cliente va solo en la primera entrega.** Una v2, v3, etc. no repite el aviso — ya se dijo una vez, y repetirlo en cada revisión sería ruido (mismo criterio que SPEC-030 regla 10 para "actualizada" vs. bienvenida).
5. **El aviso no expone por qué se calculó así** (ni la edad exacta, ni la fecha de nacimiento) en el mensaje al cliente: alcanza con la frase de consentimiento. El entrenador, en cambio, sí puede ver la edad en la ficha (SPEC-016, ya existente) — ahí no es información nueva.

## 7. Estados

**Ninguno nuevo, ninguna transición nueva** (regla 1). Esto es una notificación, no una regla de la máquina de estados.

## 8. Errores

| Situación | Efecto |
|---|---|
| Ni `age` ni `birthDate` presentes | `isMinorClient` devuelve `false` — se procesa como cualquier evaluación (regla 2) |
| `birthDate` inválido (ya rechazado por SPEC-016/fix reciente) | Llega como `null` a `isMinorClient`; cae al fallback de `age` |

## 9. Seguridad

- No se agrega ningún campo nuevo a la base: `isMinorClient` se calcula en caliente a partir de columnas que ya existen (`assessments.age`, `assessments.birth_date`).
- El resultado que viaja entre capas es un booleano, nunca la fecha de nacimiento ni la edad — mismo criterio que `hasLimitations` (SPEC-001 regla 8 del aviso).

## 10. Criterios de aceptación

- **CA-1** — DADO un cliente con `birthDate` que lo hace menor de 18 años, CUANDO llega su evaluación, ENTONCES el aviso al entrenador incluye la línea de menor de edad.
- **CA-2** — DADO un cliente con `birthDate` de 18 años o más, CUANDO llega su evaluación, ENTONCES el aviso al entrenador NO incluye esa línea.
- **CA-3** — DADO un cliente sin `birthDate` pero con `age` menor a 18, CUANDO llega su evaluación, ENTONCES se lo trata igual que si tuviera `birthDate` (fallback, D2).
- **CA-4** — DADO un cliente sin `birthDate` ni `age`, CUANDO llega su evaluación, ENTONCES NO se marca como menor (regla 2).
- **CA-5** — DADO un cliente menor, CUANDO el entrenador le envía su primera rutina (`versionNumber === 1`), ENTONCES el mensaje al cliente incluye la línea pidiendo que un padre/tutor hable con el entrenador.
- **CA-6** — DADO ese mismo cliente, CUANDO el entrenador le envía una v2, ENTONCES el mensaje NO repite esa línea (regla 4).
- **CA-7** — DADO cualquiera de los dos avisos, CUANDO se revisan sus textos, ENTONCES ninguno expone la edad exacta ni la fecha de nacimiento (regla 5).

## 11. Tests

| Nivel | Caso |
|---|---|
| Unit | `isMinorClient`: con `birthDate` (menor, justo en el borde de 18, mayor), con solo `age`, sin ninguno, con los dos presentes y `birthDate` ganando |
| Unit | `buildAssessmentArrived` con `isMinor: true` y `false` |
| Unit | `enviar()` de `delivery.ts`: primera entrega con `clientIsMinor: true` lleva la línea, una v2 no |

## 12. Archivos que toca

```
supabase/functions/_core/assessment/minor.ts          isMinorClient (nuevo)
supabase/functions/_core/telegram/notify.ts            AssessmentSummary.isMinor, buildAssessmentArrived
supabase/functions/_core/ports/delivery-ports.ts       VersionForDelivery.clientIsMinor
supabase/functions/_core/telegram/delivery.ts          la línea en la primera entrega
supabase/functions/_core/tally/webhook.ts              calcular isMinor al armar el aviso
supabase/functions/_shared/db.ts                       propagar clientIsMinor desde la base
```
