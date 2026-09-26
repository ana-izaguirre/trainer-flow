# SPEC-007 — Comandos del entrenador

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-003, SPEC-009 |
| **Sesiones** | S-25 |

## Resultado

| Pieza | Estado |
|---|---|
| `matchClientName`: exacto, parcial, ambiguo, sin match | ✅ 9 tests |
| Los cinco comandos + uno desconocido | ✅ 21 tests |
| Formateo y paginación a 20 | ✅ 35 tests |
| Las cuatro consultas SQL | ✅ 22 tests de integración |
| Cableado al webhook y al handler | ✅ |

## 1. Objetivo

El entrenador consulta el estado de su cartera de clientes desde Telegram, sin
dashboard.

## 2. Alcance

**Incluye:** `/clientes`, `/cliente <nombre>`, `/pendientes`, `/checkins`,
`/ayuda`.

**No incluye:** crear o editar clientes desde Telegram.

## 3. Contratos

### `/clientes`

```
👥 Tus clientes (4)

• Carlos — rutina activa · check-in al día
• Marta — ⏳ rutina pendiente de revisión
• Luis — ⚠️ check-in sin responder (5 días)
• Ana — 🔗 sin vincular al bot
```

### `/cliente Carlos`

```
👤 Carlos Pérez
Objetivo: Ganancia muscular · Intermedio
4 días · 60 min · Gimnasio
⚠️ Limitación: hombro

📋 Rutina v2 — enviada hace 12 días
📊 Último check-in: semana 2 — 3/4 sesiones · 💪 Bien
```

### `/pendientes`

Versiones en `DRAFT` y solicitudes de cambio abiertas, con acción directa.

### `/checkins`

Check-ins en `PENDING` de más de 2 días.

### `/ayuda`

Lista de comandos.

## 4. Reglas de negocio

0. **El cliente tiene los suyos: `/rutina`, `/actualizar` (SPEC-027) y `/ayuda`.** Cualquier otro
   comando suyo devuelve su ayuda — no se lleva ningún dato, pero sale
   sabiendo qué SÍ puede hacer. Antes chocaba con un muro incluso al pedir
   ayuda, así que alguien recién vinculado no tenía forma de averiguarlo.
1. **Las consultas de la cartera son exclusivas del entrenador.** Un cliente que los
   escriba recibe un mensaje genérico.
2. `/cliente` busca por coincidencia parcial, sin distinguir mayúsculas.
   Varias coincidencias: cada una es un botón (`cli:<clientId>`) que abre
   su ficha (SPEC-022 §12.ter M4). **Sin nombre (`/cliente` a
   secas): se pide que lo escriba.** No es lo mismo que «no hay nadie con ese
   nombre» — decirlo así deja al entrenador escribiendo el comando otra vez
   sin saber qué le falta (visto en uso real: Carlos lo probó dos veces).
3. **Sin coincidencias: se sugiere por iniciales, no por distancia de edición.**
   Con diez clientes, un Levenshtein es maquinaria para un problema que no
   existe. Si nada contiene lo escrito, se ofrecen los que empiezan por la
   misma letra; si tampoco hay, se dice que no hay nadie con ese nombre.
4. **Las listas se parten en mensajes de 20.** No se truncan: con 25 clientes
   salen dos mensajes, no uno con 20 y el resto perdido. Telegram corta en
   4096 caracteres, así que `splitMessage` sigue siendo la última red.
5. `/pendientes` incluye botones que llevan directo a la acción de SPEC-004.
6. Un comando desconocido responde con `/ayuda`.
7. **`/cliente <nombre>` lleva botones, condicionados al estado de la rutina
   vigente** (S-49): los mismos orígenes que la tarjeta original si está en
   `NEW`, aprobar/rechazar en `DRAFT`, rechazar en `APPROVED`, y **crear una
   versión nueva** en `SENT` o `REJECTED` — los dos estados que antes no
   tenían ningún camino de vuelta una vez que la tarjeta original se perdía
   en el chat. Nunca repite «Editar»: ese flujo no existe todavía (SPEC-004).
   Ver `docs/STATE-MACHINE.md` → «Cobertura de salida» para la tabla completa
   y el porqué de cada exclusión.

## 5. Estados

Solo lectura. No cambia estados.

**Eso es una propiedad, no una nota.** Estos comandos no pueden aprobar, ni
enviar, ni tocar una versión: el puerto que usan no expone ninguna escritura.
Los botones de `/pendientes` **y los de `/cliente <nombre>`** llevan a las
acciones de SPEC-004 y SPEC-010, que sí escriben y ya tienen su propia
autorización.

## 6. Errores

| Situación | Efecto |
|---|---|
| Cliente no encontrado | Sugerencias de nombres parecidos |
| Varias coincidencias | Un botón por cliente, que abre su ficha |
| `cli:` de un cliente ajeno o inexistente | La misma respuesta neutra, sin ficha |
| Sin clientes | Mensaje de bienvenida con instrucciones |
| Comando desconocido | Se muestra `/ayuda` |
| Cliente usa un comando | Mensaje genérico, sin filtrar datos |

## 7. Seguridad

- **Autorización antes de cualquier consulta.** Se verifica el `chat_id` del
  entrenador antes de tocar la base de datos.
- El entrenador solo ve **sus** clientes (filtro por `trainer_id`).
- Un cliente nunca obtiene información de otro cliente.

## 8. Criterios de aceptación

- **CA-1** — DADO 4 clientes, CUANDO el entrenador envía `/clientes`,
  ENTONCES recibe los 4 con su estado real.
- **CA-2** — DADO `/cliente carl` (parcial, minúsculas), CUANDO se envía,
  ENTONCES devuelve la ficha de Carlos.
- **CA-3** — DADO dos clientes que empiezan por "Mar", CUANDO se busca "Mar",
  ENTONCES se listan ambos para elegir.
- **CA-4** — DADO un cliente que envía `/clientes`, CUANDO llega, ENTONCES
  recibe un mensaje genérico y **ningún dato**.
- **CA-5** — DADO 2 versiones en `DRAFT`, CUANDO se envía `/pendientes`,
  ENTONCES aparecen ambos con botones funcionales.
- **CA-6** — DADO 25 clientes, CUANDO se envía `/clientes`, ENTONCES salen
  **dos mensajes** con los 25, no uno con 20.
- **CA-7** — DADO un check-in `PENDING` de hace 3 días, CUANDO se envía
  `/checkins`, ENTONCES aparece; uno de ayer, no.
- **CA-8** — DADO un comando desconocido, CUANDO lo escribe el entrenador,
  ENTONCES recibe `/ayuda` y **ninguna consulta toca la base de datos**.
- **CA-9** — DADO que el entrenador aún no tiene clientes, CUANDO envía
  `/clientes`, ENTONCES recibe instrucciones, no una lista vacía.
- **CA-10** — DADO un cliente con su rutina vigente en `SENT` o `REJECTED`,
  CUANDO se pide `/cliente <nombre>`, ENTONCES la ficha lleva un botón para
  crear una versión nueva. DADO `APPROVED`, ENTONCES NO lo lleva.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `parseCommand` para los 5 comandos y uno desconocido |
| Unit | `matchClientName`: exacto, parcial, ambiguo, sin match |
| Unit | `formatClientList` pagina a los 20 |
| Unit | `isAuthorizedChat` rechaza el `chat_id` de un cliente |
| Integration | CA-1 a CA-5 |

## 10. Archivos que toca

```
supabase/functions/_core/commands/router.ts        el despacho
supabase/functions/_core/commands/match.ts         búsqueda por nombre
supabase/functions/_core/commands/format.ts        los mensajes
supabase/functions/_core/ports/query-ports.ts      solo lectura, a propósito
supabase/functions/_shared/db.ts                   el adaptador
supabase/functions/_core/telegram/webhook.ts       el enrutado
supabase/migrations/0011_trainer_queries.sql       las consultas
```
