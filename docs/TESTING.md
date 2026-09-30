# TrainerFlow — Estrategia de calidad

## TDD: el ciclo obligatorio

Para todo lo que viva en `supabase/functions/_core/`:

```
1. RED    → escribir el test que falla
2. GREEN  → el código mínimo que lo hace pasar
3. REFACTOR → limpiar sin romper el test
```

**No se escribe lógica de `_core` sin un test que falle antes.**

Los criterios de aceptación de cada spec se traducen directamente en tests.
Una spec sin criterios verificables no está lista para implementarse.

## Por qué `_core` es TDD-able

`_core` es TypeScript puro: sin `Deno.*`, sin `fetch`, sin base de datos.
Eso significa que Vitest en Node puede importarlo y probarlo sin levantar
nada. Es el motivo de la regla del ADR-001.

## Pirámide

| Nivel | Qué prueba | Herramienta | Velocidad |
|---|---|---|---|
| **Unit** | Funciones de `_core` | Vitest (Node) | ms |
| **Integration** | Función + Postgres real | Supabase local | segundos |
| **E2E** | Flujo completo | Script contra Supabase local | minutos |

## Unit — qué se prueba siempre

| Módulo | Casos obligatorios |
|---|---|
| `authorization.ts` | Cada regla: permitido **y cada caso denegado**. Cliente no ve `DRAFT`. Cambiar un ID no da acceso. |
| `state-machine.ts` | Las 11 transiciones válidas. **Todas las inválidas rechazadas.** Que `DRAFT → SENT` sea imposible. |
| `validate-draft.ts` | Draft válido. JSON roto. Campos faltantes. Días ≠ los pedidos. `sets` fuera de rango. **Manual inválido se rechaza igual que IA inválida.** |
| `templates.ts` | Las 4 plantillas pasan `validateDraft`. Ordenación por criterios. **Nunca devuelve lista vacía.** |
| `editor/commands.ts` | Cada comando del editor. Comando sobre versión `SENT` rechazado. |
| `ai/rate-limit.ts` | Bajo el límite. En el límite exacto. Sobre el límite. Ventana expirada. |
| `ai/prompt-builder.ts` | Incluye las limitaciones del cliente siempre. |
| `telegram-format.ts` | Escapado de caracteres especiales. Mensaje que excede 4096 caracteres. |

### Tests que no prueban código, sino arquitectura

`tests/unit/architecture.test.ts` comprueba que **ningún archivo de `_core`
menciona un proveedor de IA** (ADR-007, SPEC-002 CA-8). Falla en el momento
exacto en que alguien acopla el dominio a Gemini.

Vive fuera de `_core` a propósito: necesita leer el sistema de archivos, y ahí
dentro eso está prohibido.

**El resto del aislamiento lo hace cumplir el linter**, no un test: `Deno`,
`process`, `fetch`, imports `npm:`/`jsr:`/`https:` y cualquier import de
`_shared` fallan en `pnpm lint` con el mensaje del ADR. Comprobado con
violaciones deliberadas: las 6 reglas disparan.

## Integration — qué se prueba

- **Idempotencia real:** insertar el mismo `(source, external_id)` dos veces y
  comprobar que la segunda falla por constraint.
- **Versionado inmutable:** crear v2 no toca v1.
- **Atomicidad:** `create_workout_version` deja las tres tablas consistentes.
- **Guarda de concurrencia:** una doble pulsación registra una sola acción.
- **Roles en la base de datos:** no se puede asignar un cliente como entrenador.
- RLS deniega todo, y `anon` no ejecuta las funciones atómicas.
- Los `CHECK` rechazan datos inválidos.

## Security — los 11 casos

`tests/integration/security.test.ts` cubre la tabla de `SECURITY.md`. Con RLS en
denegación total, **`_core/authorization.ts` es la única capa que separa a un
cliente de los datos de otro**: por eso su cobertura es del 100% obligatorio.

## E2E — los cuatro flujos críticos

Contra PostgreSQL real, con Telegram y el `AIProvider` mockeados.

### E2E-1 — Rutina manual *(el más importante)* ✅ IMPLEMENTADO

`tests/e2e/manual-workout.test.ts`. **Qué cubre y qué no:** el flujo de dominio
completo contra PostgreSQL real, usando las funciones SQL, la máquina de
estados, la validación, el editor, la autorización y el formateo. **No** cubre
el transporte HTTP ni la API de Telegram — levantar las Edge Functions necesita
PostgREST. El handler lo verifica `deno check`.


```
entrenador crea rutina → carga plantilla → añade ejercicios
                       → aprueba → envía
→ el cliente ve la versión publicada
→ ai_generations tiene CERO filas
```

Prueba que el producto funciona **sin IA**.

### E2E-2 — Rutina con IA ✅ IMPLEMENTADO

```
solicita generación → el proveedor devuelve un draft → se valida
                    → el entrenador lo edita → aprueba → envía
→ el cliente recibe la versión EDITADA, no la respuesta cruda de la IA
```

Se asevera que `contenido_enviado !== respuesta_del_proveedor`. Ese assert es
el principio de producto convertido en test.

### E2E-3 — Fallo de IA ✅ IMPLEMENTADO

```
solicita generación → el proveedor devuelve 429
                    → la versión vuelve a NEW
                    → el entrenador recibe el aviso
                    → elige plantilla → completa → publica
```

Prueba la degradación controlada de extremo a extremo.

### E2E-4 — Solicitud de cambio ✅ IMPLEMENTADO

`tests/e2e/change-request.test.ts`. Mismo alcance que E2E-1: el flujo de
dominio completo contra PostgreSQL real —autorización, el contrato del
`callback_data`, editor, validación y máquina de estados—, sin transporte
HTTP ni API de Telegram (la entrega usa la transición directa, igual que
E2E-1; `deliverVersion` ya tiene su propio test unitario con el
`TelegramSender` mockeado).

```
v1 SENT → el cliente pide un cambio → el entrenador crea v2
        → v2 aprobada y enviada
→ current_version_id apunta a v2
→ v1 conserva su contenido BYTE A BYTE, su estado y su sent_at
```

El assert sobre v1 es lo que prueba el punto §7.

## Mutation testing — si los tests notarían un error

La cobertura dice que una línea **corrió**. No dice si algún test notaría que
esa línea está mal: la auditoría S-49 encontró errores reales con 100% de
cobertura. Mutation testing responde eso.

**Cómo funciona.** Stryker toma el código y le mete un error pequeño a
propósito —un `===` que pasa a `!==`, una condición que pasa a `true`, un
texto que pasa a `""`—. A cada versión rota se le llama *mutante*. Después
corre los tests:

| Resultado | Qué significa |
|---|---|
| Algún test falla | El mutante **murió**: los tests lo detectaron ✅ |
| Todos pasan | El mutante **sobrevivió**: hay un error que ningún test ve ❌ |

El *mutation score* es el porcentaje de mutantes que murieron.

**Qué se muta.** Los tres módulos que `vitest.config.ts` ya exige al 100% de
cobertura (`authorization.ts`, `state-machine.ts`, `validate-draft.ts`), dos
de SPEC-031 (`callback-data.ts`: parsea el `callback_data` de cualquier
botón, dato no confiable; `navigation.ts`: decide qué ve cada rol al navegar
la rutina) y uno de SPEC-019 (`exercise-library.ts`: decide si un ejercicio
enlaza a la librería real o a una búsqueda).

```bash
pnpm test:mutation                 # ~1,5 min; reporte en reports/mutation/index.html
node scripts/mutation-policy.mjs   # la política, sobre el último reporte
```

El reporte HTML muestra cada mutante sobreviviente en su línea exacta, con el
cambio que Stryker hizo y los tests que corrieron sin notarlo.

**En CI** corre cada noche (`.github/workflows/mutation.yml`) y a mano desde
Actions. No en cada PR: ejecuta los tests cientos de veces.

### La política

| Módulo | Exigido | Hoy | Por qué |
|---|---|---|---|
| `authorization.ts` | **100%** | 100% (79/79) | Es la única capa que separa datos (ADR-010) |
| `state-machine.ts` | **100%** | 100% (38/38) | Es lo que impide `DRAFT → SENT` |
| `callback-data.ts` | **100%** | 100% (74/74) | Parsea `callback_data`, dato no confiable de cualquier botón |
| `navigation.ts` | **100%** | 100% (63/63) | Decide qué ve cada rol al navegar la rutina (SPEC-031) |
| `exercise-library.ts` | **100%** | 100% (66/66) | Decide si un ejercicio enlaza a RepDB o a una búsqueda (SPEC-019) |
| `validate-draft.ts` | Se reporta | 83,9% (281/335) | Deuda conocida, abajo |

Stryker solo admite umbrales globales; `scripts/mutation-policy.mjs` los
exige por archivo.

**Lo que encontró la primera corrida.** `authorization.ts` tenía 100% de
cobertura y 5 mutantes sobrevivientes: se podían borrar las comprobaciones de
rol o de `NULL` sin que fallara nada. Se cerraron con tres tests de
denegación (`el rol cuenta, no solo el ID`), sin tocar el código.

**Lo que encontró agregar `callback-data.ts` (SPEC-031).** Nunca había
estado en el scope, así que salió deuda preexistente de la función original
`parseCallbackData` (no del código nuevo): un mutante que quitaba el `^` del
regex sobrevivía — nada probaba que el prefijo `act:`/`nav:` tuviera que
estar al INICIO del `callback_data`, no en cualquier posición. Se cerró con
un caso `xact:approve:<uuid>` en ambos parsers. El resto de los
sobrevivientes de ese archivo (7) son mutantes equivalentes: `rawAction` y
`versionId` (o `vista` y `versionId`) salen del MISMO `match` de un único
regex, así que son `undefined` los dos a la vez o ninguno — documentados
inline con `// Stryker disable next-line`, como ya se hace en
`validate-draft.ts`. `navigation.ts` (código enteramente nuevo) salió limpio
a la primera: 100%, cero sobrevivientes.

**La deuda de `validate-draft.ts`** (54 sobrevivientes):

- **28 son textos de error.** Los tests comprueban que la validación falla,
  pero no **qué** error reporta. Un código o mensaje cambiado pasa
  desapercibido. Se cierran afirmando el código de error en los tests.
- **~20 son guardas de `null` redundantes** (líneas 134, 170 y 259): cuando
  se llega ahí, el error ya quedó registrado. Probablemente son mutantes
  equivalentes, que ningún test puede matar. Se confirman leyéndolos uno a
  uno en el reporte.

Cuando se cierre esa deuda, `validate-draft.ts` pasa a la lista de exigidos.

## Reglas no negociables

1. **Toda función de `_core` nace de un test rojo.**
2. **Ningún webhook se da por terminado sin su test de idempotencia**
   (el mismo evento dos veces produce un solo efecto).
3. **La máquina de estados tiene cobertura del 100%** de transiciones,
   válidas e inválidas.
4. Los servicios externos (Gemini, Telegram) se mockean. Nunca se llaman
   de verdad en los tests.
5. Un test que falla de forma intermitente se arregla o se borra.
   Nunca se ignora.

## La capa Deno

`_core` se prueba con Vitest en Node. `_shared` y los handlers **no pueden**:
usan `Deno.env`, `fetch` e imports `npm:`. Son dos runners porque son dos
runtimes, y eso sale del ADR-001, no de una preferencia.

| Capa | Runner | Comando |
|---|---|---|
| `_core/` | Vitest (Node) | `pnpm test:run` |
| `_shared/` · handlers | `deno test` | `pnpm deno:test` |

Lo que prueba la capa Deno no es lógica —esa ya está al 100% en `_core`— sino
que esté **bien enchufada**: que el nombre de la variable de entorno sea el
correcto, que el del header sea el correcto, que un secreto que falta se note
al arrancar y no con el primer mensaje real.

`_shared` **no lleva umbral de cobertura**. Es I/O: parte de su código solo
corre cuando la red falla de una forma concreta, y perseguir el 100% ahí
produce tests que simulan el mundo en vez de probar el código. El umbral
obligatorio sigue siendo el de `_core`.

## Comandos

```bash
pnpm test             # unit (_core), en watch
pnpm test:run         # unit, una pasada (CI)
pnpm test:coverage    # unit con cobertura
pnpm test:integration # integración, contra PostgreSQL real
pnpm test:all         # unit + integración
pnpm typecheck        # tsc --noEmit
```

Los tests unitarios y los de integración usan configuraciones separadas
(`vitest.config.ts` y `vitest.integration.config.ts`) porque tienen requisitos
distintos: los unitarios no tocan nada externo y corren en paralelo; los de
integración comparten base de datos y corren en serie.

La base de tests se recrea desde las migraciones en cada ejecución. Eso es lo
que verifica CA-1 de SPEC-000: si una migración se rompe, los tests no arrancan.
