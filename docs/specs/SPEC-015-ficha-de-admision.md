# SPEC-015 — La ficha de admisión

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-001, SPEC-008 |
| **Sesiones** | S-30 |

## 1. Objetivo

Que el entrenador pueda **leer la evaluación completa** antes de decidir cómo
preparar la rutina, sin salirse de Telegram ni consultar la base.

## 2. De dónde sale

Petición del entrenador que usa el sistema: *«me costaría ver como historia
clínica del paciente»*. No es un historial en el tiempo —eso es otra cosa—:
es **la admisión**, todo lo que contestó en el formulario, leído de corrido
como un informe, y desde ahí seguir con la rutina.

### Lo que hoy falta

El aviso de nueva evaluación es **un resumen a propósito**: objetivo, nivel,
días, minutos, material, y si declaró limitaciones. Se corta ahí porque un
mensaje de Telegram se ve en la pantalla de bloqueo y `limitations_detail` es
un dato de salud.

Pero entonces **el detalle no se lee en ningún sitio** hasta que la rutina
existe. `/cliente <nombre>` tampoco lo trae, por la misma razón.

El dato está guardado entero —`limitations_detail`, `lifestyle`, `notes` y el
`raw_payload` íntegro— y no hay forma de verlo.

## 3. La solución

Un botón más en el aviso: **📄 Ver evaluación**. Al pulsarlo llega la ficha
completa como mensaje aparte; los tres botones de creación siguen donde
estaban.

**Por qué un botón y no meterlo en el aviso:** pulsar es un acto explícito.
Quien pulsa tiene el chat abierto y está mirando la pantalla. La regla de la
pantalla de bloqueo se mantiene intacta para el aviso, que es el que llega
solo.

## 4. Alcance

**Incluye:** la ficha de la evaluación que originó esa versión.

**No incluye:**
- Historial de versiones, check-ins ni solicitudes. Eso es otra spec, y
  conviene escribirla después de unas semanas de uso real.
- El `raw_payload` crudo. Es para depurar, no para leer.
- Editar la evaluación.

## 5. Contratos

```typescript
export interface IntakeForVersion {
  readonly versionId: string;
  /** De quién es. Sin esto no se puede autorizar (la lección de SPEC-013). */
  readonly client: ClientRef;
  readonly clientName: string;
  readonly goal: string;
  readonly level: Level;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  readonly hasLimitations: boolean;
  /** El detalle SÍ va aquí: es el motivo de la spec. */
  readonly limitationsDetail: string | null;
  readonly lifestyle: string | null;
  readonly notes: string | null;
  readonly submittedAt: Date;
}
```

Callback: `act:intake:<uuid>` — 4 + 6 + 1 + 36 = **47 bytes**, bajo el límite
de 64 de Telegram.

## 6. Reglas

1. **Solo el entrenador dueño.** Se comprueba pertenencia con
   `canModifyVersion` antes de leer nada, como cualquier otro flujo
   alcanzable desde un `callback_data` (SPEC-013 regla 1).
2. **Leer no transiciona.** La versión se queda donde está. Es el primer
   flujo del sistema que no escribe nada.
3. **Una versión sin evaluación no es un error.** Una rutina manual o de
   plantilla puede no tener formulario detrás: se dice, y ya.
4. **Los campos vacíos se omiten**, no se pintan como «—». Un informe con
   huecos se lee peor que uno corto.
5. **Negar suena igual que no existir**, como en SPEC-013.

## 7. Seguridad

Es el único mensaje del sistema que contiene `limitations_detail`. Va solo al
entrenador dueño, y solo tras un botón que él pulsa.

El `raw_payload` no se toca: puede traer las URLs de Tally con credenciales
dentro, que ya se redactan al ingerir.

## 8. Criterios de aceptación

- **CA-1** — DADO una versión con evaluación, CUANDO el entrenador pulsa
  📄, ENTONCES recibe objetivo, nivel, días, minutos, material, limitaciones
  con su detalle, estilo de vida y notas.
- **CA-2** — DADO que pulsa, CUANDO se atiende, ENTONCES **la versión no
  cambia de estado**.
- **CA-3** — DADO un campo vacío, CUANDO se pinta, ENTONCES esa línea no
  aparece.
- **CA-4** — DADO otro entrenador o un cliente, CUANDO pulsa sobre esa
  versión, ENTONCES no recibe nada de la ficha.
- **CA-5** — DADO una versión sin evaluación, CUANDO pulsa, ENTONCES se lo
  dice en vez de fallar.
- **CA-6** — DADO el aviso de nueva evaluación, CUANDO se arma, ENTONCES
  lleva 📄 **y** los tres botones de creación.

## 9. Archivos que toca

```
supabase/migrations/0015_intake.sql                nuevo: assessment_for_version
supabase/functions/_core/ports/intake-ports.ts     nuevo
supabase/functions/_core/assessment/intake.ts      nuevo: el flujo y el formato
supabase/functions/_core/telegram/callback-data.ts 'intake'
supabase/functions/_core/telegram/keyboard.ts      📄 en NEW_ACTIONS
supabase/functions/_core/telegram/webhook.ts       enruta
supabase/functions/_shared/db.ts                   el adaptador
supabase/functions/telegram-webhook/index.ts       cablea
```
