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
| `templates.ts` | Las 4 plantillas pasan `validateDraft`. Filtrado por criterios. |
| `editor/commands.ts` | Cada comando del editor. Comando sobre versión `SENT` rechazado. |
| `ai/rate-limit.ts` | Bajo el límite. En el límite exacto. Sobre el límite. Ventana expirada. |
| `ai/prompt-builder.ts` | Incluye las limitaciones del cliente siempre. |
| `telegram-format.ts` | Escapado de caracteres especiales. Mensaje que excede 4096 caracteres. |

### Un test que no prueba código

```typescript
it('_core no menciona a ningún proveedor de IA', () => {
  // El punto §2: el dominio no conoce a Gemini.
  expect(grepCore(/gemini|openai|anthropic/i)).toEqual([]);
});
```

Protege una decisión de arquitectura, no un comportamiento. Es barato y falla
en el momento exacto en que alguien acopla el core a un proveedor.

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

### E2E-1 — Rutina manual *(el más importante)*

```
entrenador crea rutina → carga plantilla → añade ejercicios
                       → aprueba → envía
→ el cliente ve la versión publicada
→ ai_generations tiene CERO filas
```

Prueba que el producto funciona **sin IA**.

### E2E-2 — Rutina con IA

```
solicita generación → el proveedor devuelve un draft → se valida
                    → el entrenador lo edita → aprueba → envía
→ el cliente recibe la versión EDITADA, no la respuesta cruda de la IA
```

Se asevera que `contenido_enviado !== respuesta_del_proveedor`. Ese assert es
el principio de producto convertido en test.

### E2E-3 — Fallo de IA

```
solicita generación → el proveedor devuelve 429
                    → la versión vuelve a NEW
                    → el entrenador recibe el aviso
                    → elige plantilla → completa → publica
```

Prueba la degradación controlada de extremo a extremo.

### E2E-4 — Solicitud de cambio

```
v1 SENT → el cliente pide un cambio → el entrenador crea v2
        → v2 aprobada y enviada
→ current_version_id apunta a v2
→ v1 conserva su contenido BYTE A BYTE, su estado y su sent_at
```

El assert sobre v1 es lo que prueba el punto §7.

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
