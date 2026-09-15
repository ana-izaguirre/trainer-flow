# SPEC-007 — Comandos del entrenador

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-003 |
| **Sesiones** | S-19 |

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

Planes en `TRAINER_REVIEW`, `MANUAL` o `FAILED`, con acción directa.

### `/checkins`

Check-ins en `PENDING` de más de 2 días.

### `/ayuda`

Lista de comandos.

## 4. Reglas de negocio

1. **Todos los comandos son exclusivos del entrenador.** Un cliente que los
   escriba recibe un mensaje genérico.
2. `/cliente` busca por coincidencia parcial, sin distinguir mayúsculas.
   Varias coincidencias: se listan para elegir.
3. Sin coincidencias: se sugieren nombres cercanos.
4. Las listas se limitan a 20 elementos por mensaje.
5. `/pendientes` incluye botones que llevan directo a la acción de SPEC-004.
6. Un comando desconocido responde con `/ayuda`.

## 5. Estados

Solo lectura. No cambia estados.

## 6. Errores

| Situación | Efecto |
|---|---|
| Cliente no encontrado | Sugerencias de nombres parecidos |
| Varias coincidencias | Lista para elegir |
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
- **CA-5** — DADO 2 planes en `TRAINER_REVIEW`, CUANDO se envía `/pendientes`,
  ENTONCES aparecen ambos con botones funcionales.
- **CA-6** — DADO 25 clientes, CUANDO se envía `/clientes`, ENTONCES se
  pagina en varios mensajes.

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
supabase/functions/_core/commands.ts
supabase/functions/_core/commands.test.ts
supabase/functions/_core/client-match.ts
supabase/functions/telegram-webhook/handlers/commands.ts
```
