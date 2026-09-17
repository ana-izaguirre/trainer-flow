# SPEC-005 — Vinculación y entrega al cliente

| Campo | Valor |
|---|---|
| **Estado** | **PARCIAL** — dominio completo. Falta cablear al webhook y el backoff |
| **Depende de** | SPEC-004 |
| **Sesiones** | S-19, S-20 |

## 1. Objetivo

El cliente se vincula al bot con un enlace único y recibe su rutina aprobada
por Telegram.

## 2. Alcance

**Incluye:** deep link, comando `/start <token>`, guardado del `chat_id`,
formateo para el cliente, envío, transición a `SENT`, entrega diferida.

**No incluye:** check-ins (SPEC-006).

## 3. Contratos

### Deep link

`https://t.me/<bot_username>?start=<link_token>`

Se muestra al cliente en la pantalla final de Tally (URL de redirección) y se
guarda en el registro del cliente.

### `/start <token>`

```
1. Cliente abre el enlace
2. Telegram envía: { message: { text: "/start abc123", chat: { id: 456 } } }
3. Se busca client por link_token
4. Se guarda telegram_chat_id y linked_at
5. Se le da la bienvenida
6. Si tiene un plan en APPROVED → se envía ahora
```

### Mensaje al cliente

```
👋 Hola Carlos, tu rutina está lista.

🎯 Ganancia muscular · 4 días · 60 min

━━━ Día 1 — Empuje ━━━
• Press banca — 4x8 · descanso 90s
• Press militar — 3x10 · descanso 60s

💬 Cualquier duda, habla con tu entrenador.
```

## 4. Reglas de negocio

1. Un `link_token` vincula **un solo** cliente. Ya usado con otro `chat_id`:
   se rechaza y se avisa al entrenador.
2. Un `chat_id` pertenece a un solo cliente (`UNIQUE`).
3. **Entrega diferida:** si el plan se aprueba y el cliente aún no se vinculó,
   queda en `APPROVED` (no `SENT`) y se envía automáticamente al vincularse.
4. `APPROVED → SENT` solo tras confirmación de entrega de Telegram.
5. El mensaje al cliente **no incluye** notas internas del entrenador ni el
   detalle textual de sus limitaciones: solo los ejercicios adaptados.
6. Tras el envío se notifica al entrenador: "Carlos recibió su rutina".
7. Un token inválido responde con un mensaje neutro, sin revelar si existe.
8. Reintento con backoff (máximo 3) si Telegram falla. Agotados, el plan sigue
   en `APPROVED` y se avisa al entrenador.

## 5. Estados

```
APPROVED ──► SENT
```

`SENT` es terminal. Escribe en `plan_events` con `actor = 'system'`.

## 6. Errores

| Situación | Efecto |
|---|---|
| Token inexistente | Mensaje neutro. No se filtra información |
| Token ya usado por otro `chat_id` | Se rechaza y se avisa al entrenador |
| Cliente sin vincular al aprobar | Plan en `APPROVED`. Se avisa al entrenador |
| El cliente bloqueó el bot | Plan en `APPROVED`. Se avisa al entrenador |
| Telegram `429` | Backoff, máximo 3 reintentos |
| Cliente se vincula sin plan aprobado | Bienvenida y a esperar |

## 7. Seguridad

- **`link_token` es una credencial.** CSPRNG, 32 bytes, nunca en logs.
- Un token inválido y uno válido ya usado dan la misma respuesta neutra:
  no se permite enumerar clientes.
- El cliente solo recibe su propia rutina. El `chat_id` determina la identidad.
- La rutina enviada al cliente omite el texto crudo de sus limitaciones.

## 8. Criterios de aceptación

- **CA-1** — DADO un cliente sin vincular con token válido, CUANDO envía
  `/start <token>`, ENTONCES se guardan `telegram_chat_id` y `linked_at`.
- **CA-2** — DADO un cliente vinculado con un plan en `APPROVED`, CUANDO se
  aprueba, ENTONCES recibe la rutina y el plan pasa a `SENT`.
- **CA-3** — DADO un cliente **no** vinculado, CUANDO se aprueba su plan,
  ENTONCES queda en `APPROVED` y el entrenador recibe el aviso.
- **CA-4** — DADO el caso CA-3, CUANDO el cliente se vincula después,
  ENTONCES recibe la rutina automáticamente y el plan pasa a `SENT`.
- **CA-5** — DADO un token inexistente, CUANDO se envía, ENTONCES la respuesta
  es neutra y no revela nada.
- **CA-6** — DADO un token ya usado por otro `chat_id`, CUANDO se reutiliza,
  ENTONCES se rechaza y se avisa al entrenador.
- **CA-7** — DADO un plan enviado, CUANDO se revisa el mensaje, ENTONCES no
  contiene `limitations_detail` en crudo.
- **CA-8** — DADO un plan en `SENT`, CUANDO se intenta enviarlo otra vez,
  ENTONCES no se duplica.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `formatClientMessage` omite datos internos |
| Unit | `parseStartCommand` con token válido, ausente y malformado |
| Unit | Máquina de estados: `APPROVED→SENT` válida, `SENT→*` rechazada |
| Integration | CA-1 a CA-6, CA-8 |
| E2E | Pasos 7–8 del camino crítico |

## 10. Archivos que toca

```
supabase/functions/_core/client-format.ts
supabase/functions/_core/client-format.test.ts
supabase/functions/_core/start-command.ts
supabase/functions/telegram-webhook/handlers/start.ts
supabase/functions/send-plan/index.ts
```
