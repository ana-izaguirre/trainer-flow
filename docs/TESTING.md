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
| `state-machine.ts` | Cada transición válida. **Cada transición inválida rechazada.** Que `DRAFT → SENT` sea imposible. |
| `tally-parser.ts` | Payload completo. Campos faltantes. Tipos incorrectos. Campo extra desconocido. |
| `rate-limit.ts` | Bajo el límite. En el límite exacto. Sobre el límite. Ventana expirada. |
| `plan-validator.ts` | Respuesta de Gemini válida. JSON roto. Días ≠ los pedidos. Ejercicio contraindicado por la limitación declarada. |
| `telegram-format.ts` | Escapado de caracteres especiales. Mensaje que excede 4096 caracteres. |

## Integration — qué se prueba

- **Idempotencia real:** insertar el mismo `(source, external_id)` dos veces
  y comprobar que la segunda falla por constraint.
- Las políticas RLS bloquean lo que deben bloquear.
- Los `CHECK` constraints rechazan datos inválidos.
- El índice parcial de `TRAINER_REVIEW` se usa.

## E2E — el camino crítico

Un solo escenario, ejecutado contra Supabase local:

```
1. POST simulado de Tally con firma válida
2. → cliente y evaluación creados, respuesta < 1s
3. → plan generado (Gemini mockeado), estado TRAINER_REVIEW
4. → mensaje enviado al chat del entrenador (Telegram mockeado)
5. callback_query "aprobar"
6. → estado APPROVED
7. → rutina enviada al cliente, estado SENT
8. → plan_events contiene las 5 transiciones en orden
```

Y el escenario de degradación:

```
1. Gemini devuelve 429
2. → plan en estado MANUAL
3. → entrenador recibe aviso
4. → el sistema sigue respondiendo
```

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

## Comandos

```bash
pnpm test           # unit, en watch
pnpm test:run       # unit, una pasada (CI)
pnpm test:e2e       # e2e contra Supabase local
supabase start      # levanta Postgres local
```
