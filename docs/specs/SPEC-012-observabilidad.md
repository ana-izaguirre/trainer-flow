# SPEC-012 — Observabilidad

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-002, SPEC-011 |
| **Sesiones** | S-26 |

## 1. Objetivo

Que se pueda **seguir una petición de extremo a extremo**: desde el botón que
la dispara hasta la última fila que escribe, con un solo identificador.

## 2. Lo que ya existe

No se parte de cero. Esto ya está y no se toca:

| Pieza | Dónde | Estado |
|---|---|---|
| Formato JSON de una línea | `_core/observability/log-event.ts` | ✅ |
| Redacción por nombre de campo | idem | ✅ 8 campos prohibidos |
| Emisión a stdout | `_shared/logger.ts` | ✅ |
| `requestId` por petición | las 4 funciones | ✅ |
| `durationMs` en el cierre | las 4 funciones | ✅ |
| `request_id` en la base | `webhook_events`, `plan_events`, `ai_generations` | ✅ |

**La spec no añade infraestructura.** No hay OpenTelemetry, ni Sentry, ni un
servicio de trazas. Con este volumen, Supabase Logs alcanza.

## 3. Los tres huecos

### 3.1 La cadena se rompe en el único salto asíncrono

`generation-trigger.ts` propaga el identificador. Lo manda en el cuerpo:

```typescript
body: JSON.stringify({ versionId, requestId }),
```

`generate-version/index.ts` lo **tira y se inventa otro**:

```typescript
const versionId = isRecord(body) ? body['versionId'] : null;   // lee versionId
const requestId = crypto.randomUUID();                          // ignora el que llegó
```

**Consecuencia real.** El entrenador pulsa «Generar»:

```
telegram-webhook   req-A   →  webhook_events.request_id = req-A
        ↓ dispara con requestId: req-A en el cuerpo
generate-version   req-B   →  ai_generations.request_id = req-B
                              plan_events.request_id    = req-B
```

Buscar `req-A` en los logs muestra la pulsación del botón **y nada más**. La
generación que causó es invisible. Es exactamente el criterio de cierre de
S-26 fallando en el único sitio donde cuesta trabajo cumplirlo: los otros
tres flujos son una sola función de principio a fin.

### 3.2 Una excepción no deja rastro

`weekly-checkin` envuelve su trabajo en `try/catch` y loguea `checkin.failed`.
Las otras tres no tienen catch de último recurso.

`_core/ai/generate-version.ts` **no tiene ni un `catch`**. Si la base rechaza
una escritura, la excepción sube hasta `Deno.serve`, que responde 500 sin
emitir una sola línea estructurada: sin `requestId`, sin `durationMs`, sin
nombre de evento.

> El caso que más necesitas rastrear es el que menos información produce.

Y es la función con más superficie de fallo: red hacia el proveedor de IA,
timeouts, y cuatro escrituras.

### 3.3 Tener los logs no es saber buscarlos

No hay ningún documento que diga cómo se pasa de «el cliente dice que no le
llegó la rutina» a la línea de log que lo explica. A las 11 de la noche, eso
es lo que decide si la observabilidad sirve de algo.

## 4. Contratos

### La línea de log

```typescript
interface LogEvent {
  readonly event: string;      // `generate.generated`, `telegram.unauthorized`
  readonly level: LogLevel;    // debug | info | warn | error
  readonly requestId: string;  // cruza logs con las tres tablas
  readonly [key: string]: unknown;
}
```

Sin cambios. Lo que cambia es **quién lo emite y con qué `requestId`**.

### El cuerpo de `generate-version`

```typescript
{ versionId: string; requestId?: string }
```

`requestId` es **opcional**: `curl` a mano y un disparo antiguo en vuelo
durante un despliegue no llevan ninguno, y ninguno de los dos casos puede
tumbar la generación.

## 5. Reglas

1. **Un identificador por cadena causal, no por función.** Si una función
   recibe un `requestId` válido, lo usa. Solo se genera uno nuevo cuando no
   llega ninguno.
2. **Solo se acepta un UUID.** Quien llama es de confianza, pero el
   identificador acaba en una columna `uuid` de la base: uno con otra forma
   haría fallar la escritura, que es peor que perder la correlación.
   Un valor con forma inválida se descarta y se genera uno nuevo.
3. **Toda petición emite exactamente una línea de cierre**, pase lo que pase:
   éxito, rechazo o excepción. Con `requestId` y `durationMs` siempre.
4. **Una excepción se loguea con `level: error`** y el mensaje del error,
   nunca el stack: un stack puede arrastrar valores de variables.
5. **El log nunca es el que decide la respuesta HTTP.** Si el logging falla,
   la petición sigue. (Ya se cumple: `formatLogLine` captura su propio fallo.)
6. **Nada nuevo que redactar.** Los campos que se añaden (`versionId`,
   `durationMs`, `event`) son identificadores y métricas, no datos de nadie.

## 6. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Llega `requestId` con forma de UUID | 202 | Se usa: la cadena queda unida |
| Llega `requestId` que no es UUID | 202 | Se genera uno nuevo; se loguea `warn` |
| No llega `requestId` | 202 | Se genera uno nuevo, en silencio |
| El dominio lanza | 500 | Línea `*.excepcion` con `requestId` y `durationMs` |

## 7. Seguridad

El `requestId` es un UUID aleatorio sin significado: no identifica a nadie ni
autoriza nada. Aceptar el de quien llama no abre ninguna puerta — lo único que
puede hacer un valor manipulado es ensuciar una búsqueda, y la regla 2 lo
acota a un UUID.

La red de redacción de `log-event.ts` no cambia.

## 8. Criterios de aceptación

- **CA-1** — DADO un POST a `generate-version` con `requestId` válido en el
  cuerpo, CUANDO se procesa, ENTONCES **todas** las líneas de log llevan ese
  `requestId` y no uno nuevo.
- **CA-2** — DADO un POST sin `requestId`, CUANDO se procesa, ENTONCES se
  genera uno y la función responde igual que siempre.
- **CA-3** — DADO un `requestId` que no es un UUID, CUANDO se procesa,
  ENTONCES se descarta, se genera uno válido, y se deja constancia en un
  `warn`.
- **CA-4** — DADO que el dominio lanza una excepción, CUANDO se procesa,
  ENTONCES sale una línea `level: error` con `requestId` y `durationMs`, y la
  respuesta es 500.
- **CA-5** — DADO que el dominio lanza, CUANDO se loguea el error, ENTONCES
  la línea **no** contiene el stack.
- **CA-6** — DADO el botón «Generar», CUANDO se sigue la cadena entera,
  ENTONCES `webhook_events`, `plan_events` y `ai_generations` comparten el
  mismo `request_id`.

## 9. Tests

| Nivel | Caso |
|---|---|
| Deno | CA-1 · CA-2 · CA-3 · CA-4 · CA-5, capturando `console.log` |
| Deno | El disparo manda el `requestId` en el cuerpo (ya existe, se amplía) |
| Integration | CA-6: las tres tablas con el mismo `request_id` |
| Manual | El runbook de §10, una vez, contra logs reales (S-28) |

## 10. Entregable adicional: el runbook

`docs/RUNBOOK.md`, con una idea rectora:

> **La base es el índice, los logs son el detalle.**
> Se empieza por una persona o una rutina, se saca el `request_id` de la base,
> y con él se leen los logs.

Tres recorridos, cada uno con su consulta:

1. «El cliente dice que no le llegó la rutina.»
2. «La generación con IA no responde.»
3. «El bot no contesta a nadie.»

## 11. Archivos que toca

```
supabase/functions/generate-version/index.ts        acepta el requestId + catch
supabase/functions/generate-version/index.test.ts   CA-1 … CA-5
supabase/functions/telegram-webhook/index.ts        catch de último recurso
supabase/functions/tally-webhook/index.ts           catch de último recurso
supabase/functions/_shared/request-id.ts            nuevo: validar y decidir
tests/integration/observability.test.ts             CA-6
docs/RUNBOOK.md                                     nuevo
```

## 12. Una decisión que cambió al implementar

La spec decía `_shared/request-id.ts`. Acabó en
`_core/observability/request-id.ts` porque **decidir qué identificador se usa
es una regla, no I/O**: valida una forma y elige entre dos valores.

`crypto.randomUUID()` entra por parámetro, igual que `now: () => new Date()`
en el resto del sistema. Así `_core` sigue sin tocar globales y el test es
determinista en vez de depender de lo que salga del generador.

## 13. Lo que esta spec NO hace

- Métricas agregadas, dashboards o alertas. Eso necesita un cliente real
  primero (S-28).
- Trazas distribuidas con spans. Un identificador plano cubre una cadena de
  dos saltos.
- Persistir `duration_ms` en una tabla. Está en el log, que es donde se busca.
