# SPEC-014 — El enlace del cliente llega al entrenador

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-001, SPEC-005 |
| **Sesiones** | S-29 |

## 1. Objetivo

Que el entrenador **reciba el enlace de vinculación** del cliente en el mismo
aviso donde ya se entera de la evaluación, para reenviárselo por donde ya
hablan.

## 2. El hueco que cierra

El `link_token` se genera al ingerir la evaluación, se guarda en
`clients.link_token`… y **nadie lo entrega nunca**. No sale en el aviso de
nueva evaluación, ni en `/clientes`, ni en `/cliente`, ni en ningún mensaje.

Sin ese enlace el cliente no se vincula, y una rutina aprobada se queda en
`APPROVED` para siempre. Está todo construido menos la flecha que conecta al
cliente con el bot.

### Por qué no se resuelve desde Tally

`DEPLOY.md` decía que la pantalla final de Tally redirigiera a
`https://t.me/<bot>?start=` + el `link_token`.

**Es imposible.** Esa URL se configura *antes* de la respuesta; el token lo
genera el servidor *después*, al recibirla. Tally no puede conocerlo.

### La decisión

Se eligió **que el entrenador lo reenvíe a mano**, frente a pre-generar el
token con un campo oculto en Tally.

Razón: el entrenador ya está hablando con esa persona —acaba de mandarle el
formulario por WhatsApp—. Copiar y pegar no le añade un paso; pre-generar sí,
porque obligaría a dar de alta al cliente **antes** de que llene nada.

## 3. Alcance

**Incluye:**
- El enlace en el aviso de nueva evaluación.
- `TELEGRAM_BOT_USERNAME` como configuración obligatoria.

**No incluye:**
- Reenviar el enlace desde `/cliente <nombre>`. El mensaje sigue en el
  historial de Telegram, así que se puede buscar hacia atrás. Si resulta
  incómodo en uso real, se añade entonces — necesitaría migración, porque
  `trainer_client_detail` no devuelve el token.
- Que el bot mande el enlace al cliente. No puede: todavía no lo conoce.
- Caducidad o rotación del token.

## 4. Contratos

```typescript
export interface TallyDeps {
  // …
  /** Sin `@`. Se usa para armar `https://t.me/<usuario>?start=<token>`. */
  readonly botUsername: string;
}
```

El aviso pasa de esto:

```
📋 Nueva evaluación: Carlos
🎯 Fuerza · Principiante
3 días · 60 min
Material: Gimnasio

¿Cómo preparamos la rutina?
[🤖 Generar] [📋 Plantilla] [✍️ Manual]
```

a esto:

```
📋 Nueva evaluación: Carlos
🎯 Fuerza · Principiante
3 días · 60 min
Material: Gimnasio

🔗 Mándale este enlace a Carlos para que reciba su rutina:
https://t.me/mibot?start=kJ8xQm2vN…

¿Cómo preparamos la rutina?
[🤖 Generar] [📋 Plantilla] [✍️ Manual]
```

## 5. Reglas

1. **El enlace va en el aviso, no en el `outcome`.** El handler loguea
   `{ ...outcome }`, así que un token en el resultado acabaría en los logs.
   La red de `log-event.ts` lo redactaría solo si el campo se llamara
   `linkToken`; no se depende de eso, sino de que el token **no entre**.
2. **`TELEGRAM_BOT_USERNAME` es obligatorio y se lee al arrancar.** Sin él,
   `t.me/undefined?start=…` sería un enlace roto que nadie nota hasta que un
   cliente lo abre. Falla al desplegar, no al primer formulario (SPEC-011).
3. **El enlace se escapa como el resto del mensaje.** Va en MarkdownV2 y
   base64url produce `-` y `_`, que son caracteres especiales ahí.
4. **Solo en el aviso de una evaluación válida.** El aviso de «no se pudo
   leer» no lleva enlace: no hay ficha de cliente que vincular.
5. **El texto dice qué hacer con él.** «Mándale este enlace a X» y no un URL
   suelto: el entrenador tiene que saber que es para reenviar.

## 6. Seguridad

El token es una credencial: quien la tenga se vincula como ese cliente.

Mandárselo al entrenador por Telegram es correcto —es quien lo emite y a quien
le toca repartirlo—, pero obliga a dos cosas:

- **Nunca en un log.** Regla 1.
- **Nunca en el aviso de error de una evaluación ilegible.** Regla 4.

No se añade caducidad: el enlace se canjea una vez y `ensure_client_profile`
rechaza un segundo canje desde otra cuenta, avisando al entrenador.

## 7. Criterios de aceptación

- **CA-1** — DADO una evaluación válida, CUANDO llega, ENTONCES el aviso al
  entrenador contiene `https://t.me/<usuario>?start=<token>` con el token de
  ese cliente.
- **CA-2** — DADO ese aviso, CUANDO se envía, ENTONCES conserva los tres
  botones de creación.
- **CA-3** — DADO una evaluación ilegible, CUANDO se avisa, ENTONCES el
  mensaje **no** contiene ningún enlace.
- **CA-4** — DADO cualquier resultado, CUANDO se loguea, ENTONCES la línea
  **no** contiene el token.
- **CA-5** — DADO que falta `TELEGRAM_BOT_USERNAME`, CUANDO arranca la
  función, ENTONCES lanza nombrando la variable.
- **CA-6** — DADO un token con `-` o `_`, CUANDO se pinta, ENTONCES el
  enlace queda escapado y Telegram lo acepta.

## 8. Tests

| Nivel | Casos |
|---|---|
| Unit | CA-1, CA-2, CA-3, CA-6 sobre `buildAssessmentArrived` |
| Unit | CA-4: el `outcome` de `handleTallyWebhook` no lleva el token |
| Deno | CA-5 en `readDeps` |

## 9. Archivos que toca

```
supabase/functions/_core/telegram/notify.ts     el enlace en el aviso
supabase/functions/_core/tally/webhook.ts       captura el token y lo pasa
supabase/functions/tally-webhook/index.ts       lee TELEGRAM_BOT_USERNAME
docs/DEPLOY.md                                  la variable, en el paso 4
docs/SECURITY.md                                configuración no secreta
```
