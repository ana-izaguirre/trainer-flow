# SPEC-035 — Alta del primer entrenador, sin SQL manual

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-009 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que desplegar el sistema por primera vez —o en un ambiente nuevo (staging,
un reemplazo de producción)— no exija escribir un `insert` a mano en
`profiles`. Hoy es el paso 9 de `docs/DEPLOY.md`:

```sql
insert into profiles (telegram_user_id, telegram_chat_id, role, full_name)
values (<tu_id>, <tu_id>, 'trainer', 'Tu nombre');
```

## 2. Esto NO es multi-entrenador

CLAUDE.md prohíbe explícitamente "Multi-entrenador" en V1, y esta spec no lo
toca: el sistema sigue sirviendo a **un solo entrenador**. El gap que resuelve
es distinto — es un problema de **onboarding**, no de producto: hoy, antes de
que exista ESE primer entrenador, no hay forma de usar el bot sin tocar SQL.

La guarda central de esta spec es justamente **que deja de funcionar en el
momento en que el primer entrenador existe** — no abre una puerta que quede
abierta.

## 3. La decisión de diseño

### 3.1 Un comando que solo funciona una vez

```
¿Ya existe algún profiles.role = 'trainer'?
   SÍ  → el comando responde lo mismo que cualquier comando desconocido
   NO  → si el secreto coincide, nace el entrenador
```

Es la misma excepción que ya documenta `webhook.ts` para `/start <token>`
("el único update que crea identidad... la autorización se concedió antes de
que la persona escribiera"), aplicada una vez más y con la misma cautela: acá
NADIE concedió autorización todavía, así que la única autorización posible es
un secreto que solo quien despliega conoce.

### 3.2 El secreto, no el `telegramUserId`

Sin verificar nada más que "¿sos el primero en escribir?", cualquiera que
encuentre el bot antes que Ana podría auto-nombrarse entrenador. Por eso el
comando exige un secreto —`BOOTSTRAP_SECRET`, mismo patrón que
`TELEGRAM_WEBHOOK_SECRET` (docs/SECURITY.md)— conocido solo por quien
despliega, nunca commiteado.

### 3.3 Qué pasa después del primer entrenador

Nada. El comando sigue existiendo pero su primera comprobación
(`¿hay algún trainer?`) ya da `SÍ` para siempre, así que responde como
cualquier comando no reconocido. No hace falta "desactivarlo" aparte: la
guarda es automática y permanente.

## 4. Alcance

**Incluye:**
- `/bootstrap <secreto> <nombre>`, solo utilizable antes de que exista
  ningún entrenador.
- La variable `BOOTSTRAP_SECRET` en `supabase/functions/.env` (local) y
  `supabase secrets set` (producción) — mismo tratamiento que cualquier otro
  secreto (CLAUDE.md, sección Secretos).
- Actualizar `docs/DEPLOY.md` paso 9 para usar el comando en vez del `insert`.

**No incluye:**
- Dar de alta a un SEGUNDO entrenador — eso es SPEC-034, y sigue sin diseño
  hasta que se resuelvan sus preguntas de producto.
- Ningún cambio a la autorización existente (`_core/authorization.ts`): sigue
  asumiendo un solo `trainer_id` real en uso.
- Recuperar el acceso si se pierde el secreto o el chat del entrenador — eso
  sigue siendo un `insert` manual, igual que hoy, porque es un caso que por
  definición ya rompió el flujo normal.

## 5. Contratos

### Variable de entorno

```
BOOTSTRAP_SECRET=<alfanumérico largo, generado una vez por despliegue>
```

### Comando

`/bootstrap <secreto> <nombre completo>`, solo del lado del webhook de
Telegram, antes de resolver identidad (mismo punto del flujo que
`/start <token>` en `webhook.ts` — ver su comentario "por qué el paso 4 va
antes del 5").

## 6. Reglas de negocio

1. El comando solo actúa si NINGÚN `profiles.role = 'trainer'` existe
   todavía. Con uno o más, se trata como comando desconocido — **sin decir
   por qué**, para no confirmarle a un desconocido que el bootstrap ya pasó
   ni que existe tal comando.
2. El secreto se compara en tiempo constante (`_core/security/constant-time.ts`,
   ya usado para `TELEGRAM_WEBHOOK_SECRET`): un timing attack no debe poder
   distinguir "secreto incorrecto" de "ya hay un entrenador".
3. Un secreto incorrecto, con o sin entrenador ya existente, da la MISMA
   respuesta neutra. No se filtra cuál de las dos cosas falló.
4. El nombre es obligatorio y se acota en longitud, igual que cualquier texto
   libre que entra al sistema (SPEC-001 §7).
5. El `telegramUserId`/`telegramChatId` de quien ejecuta el comando son los
   que quedan en el `profiles` nuevo — igual que el `insert` manual de hoy.
6. El secreto **nunca se loguea**, ni siquiera al rechazarlo (mismo trato que
   cualquier secreto, CLAUDE.md).

## 7. Errores

| Situación | Respuesta |
|---|---|
| Ya existe un entrenador | Igual que un comando desconocido — sin mencionar el bootstrap |
| Secreto incorrecto (sin entrenador aún) | La misma respuesta neutra que el caso anterior |
| Falta el nombre | Se pide completo, sin tocar la base |
| `BOOTSTRAP_SECRET` no configurado | El comando se comporta como si ya existiera un entrenador — nunca falla abierto |

## 8. Seguridad

- Es la segunda (y última) excepción a "nadie se auto-registra" (SPEC-009
  §3), y queda tan acotada como la primera: un secreto fuera de banda, nunca
  en el código, y una ventana que se cierra sola en cuanto se usa una vez.
- `BOOTSTRAP_SECRET` sigue la regla general de secretos: un solo sitio, nunca
  en un archivo versionado, el CI lo detecta si aparece en el historial.
- Si `BOOTSTRAP_SECRET` falta, el comando debe fallar CERRADO (tratarlo como
  "ya hay un entrenador"), nunca abierto.

## 9. Criterios de aceptación

- **CA-1** — DADO que `profiles` no tiene ningún `trainer`, CUANDO alguien
  envía `/bootstrap <secreto correcto> Ana Gómez`, ENTONCES nace el perfil
  con `role = 'trainer'` y se confirma.
- **CA-2** — DADO que ya existe un `trainer`, CUANDO alguien envía
  `/bootstrap <cualquier cosa>`, ENTONCES responde igual que un comando
  desconocido.
- **CA-3** — DADO que no existe ningún `trainer` todavía, CUANDO el secreto
  es incorrecto, ENTONCES la respuesta es indistinguible de CA-2.
- **CA-4** — DADO que dos personas intentan `/bootstrap` casi al mismo
  tiempo con el secreto correcto, ENTONCES solo una gana (misma guarda de
  concurrencia que ya usan las transiciones de versión, no una comprobación
  previa que ambas pasarían).
- **CA-5** — El secreto nunca aparece en ningún log, en ningún camino.

## 10. Tests

| Nivel | Caso |
|---|---|
| Unit | La decisión (hay/no hay entrenador, secreto correcto/incorrecto) |
| Integration | CA-1, CA-4 — contra PostgreSQL real, con el `UNIQUE`/guarda que decide el ganador de la concurrencia |
| Integration | El secreto no aparece en `plan_events` ni en ninguna tabla de log |

## 11. Archivos que toca

```
supabase/migrations/00XX_bootstrap_trainer.sql   la función que decide atómicamente
supabase/functions/_core/commands/bootstrap.ts   el comando (nuevo)
supabase/functions/_core/telegram/webhook.ts     el enrutamiento, antes del paso 5
supabase/functions/_shared/env.ts                lee BOOTSTRAP_SECRET
docs/DEPLOY.md                                   paso 9 reemplazado
docs/SECURITY.md                                 BOOTSTRAP_SECRET en la lista de secretos
```
