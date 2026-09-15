# SPEC-009 — Identidad y autorización

| Campo | Valor |
|---|---|
| **Estado** | **PARCIAL** — núcleo implementado (S-05) |
| **Depende de** | SPEC-000 |
| **Sesiones** | S-05 (core) · S-09 (webhook) · S-26 (logs) |

## Resultado

`_core/authorization.ts` está implementado con **cobertura del 100%**
(statements, branches, functions, lines) y 22 tests.

| CA | Qué verifica | Estado |
|---|---|---|
| CA-1 | Secreto de cabecera inválido → 401 | ⏳ S-09, necesita el webhook |
| CA-2 | `telegram_user_id` sin perfil → mensaje neutro | ⏳ S-09 |
| CA-3 | Entrenador A no accede a clientes de B | ✅ |
| CA-4 | Cliente A no accede a datos de B | ✅ |
| CA-5 | Cliente no puede aprobar | ✅ (el registro del intento, en S-09) |
| CA-6 | Cliente solo ve versiones en `SENT` | ✅ |
| CA-7 | Cambiar un ID no da acceso ajeno | ✅ |
| CA-8 | Los logs no filtran datos del recurso | ⏳ S-26, necesita el logger |

Lo pendiente no es lógica de autorización: son las capas que la invocan.

## 1. Objetivo

Toda persona que interactúa con el bot tiene un perfil verificado, y ninguna
operación ocurre sin comprobar antes que quien la pide tiene derecho a hacerla.

## 2. Alcance

**Incluye:** resolución de identidad desde el webhook de Telegram, alta de
perfiles, `_core/authorization.ts` con las reglas de acceso.

**No incluye:** JWT ni políticas RLS por rol (ver ADR-010: se activan cuando
exista un cliente que porte un token). Sin frontend en V1, no hay dónde ponerlo.

## 3. Contratos

### Resolución de identidad

```
Telegram → POST /telegram-webhook
             ├─ verificar X-Telegram-Bot-Api-Secret-Token
             ├─ si no coincide → 401, cero escrituras
             └─ update.message.from.id ES CONFIABLE
                     ▼
             profiles WHERE telegram_user_id = ...
                     ▼
             ┌───────┴────────┐
          existe          no existe
             │                │
         Identity        rechazar
                    (nadie se auto-registra)
```

**El `telegram_user_id` nunca viene del usuario.** Viene dentro del update, y el
update está autenticado por el secreto de cabecera.

### Tipos

```typescript
// _core/domain/identity.ts — cero dependencias
export interface Identity {
  readonly profileId: string;
  readonly role: 'trainer' | 'client';
  readonly telegramUserId: number;
  readonly telegramChatId: number;
}

// _core/authorization.ts — funciones PURAS, sin I/O
export type AuthzResult =
  | { allowed: true }
  | { allowed: false; reason: AuthzDenial };

export function canViewClient(actor: Identity, client: ClientRef): AuthzResult;
export function canManageClient(actor: Identity, client: ClientRef): AuthzResult;
export function canViewVersion(actor: Identity, version: VersionRef): AuthzResult;
export function canModifyVersion(actor: Identity, version: VersionRef): AuthzResult;
export function canRequestChange(actor: Identity, version: VersionRef): AuthzResult;
```

Reciben los datos ya cargados y devuelven una decisión. No consultan nada: así
se prueban al 100% sin base de datos.

### Dónde termina la autorización y empieza la máquina de estados

| Pregunta | Quién responde |
|---|---|
| ¿Quién eres y de quién es este recurso? | `authorization.ts` |
| ¿Es legal esta transición desde este estado? | `state-machine.ts` (SPEC-006) |

Por eso hay **una sola** `canModifyVersion` en vez de `canEdit`, `canApprove` y
`canReject`: las tres responden a la misma pregunta —*¿es el entrenador dueño
de esta versión?*— y tenerlas separadas sería el mismo código tres veces. Qué
transición es legal desde `DRAFT` lo decide la máquina de estados.

**La excepción es `canViewVersion`**, que sí mira el estado: para un cliente,
*qué puede ver* depende de si la versión está en `SENT`. Eso es una pregunta de
visibilidad, no de transición.

## 4. Reglas de negocio

1. **Nadie se auto-registra.** Los perfiles de entrenador se crean a mano; los
   de cliente, al canjear un `link_token` (SPEC-005).
2. Un `telegram_user_id` pertenece a un solo perfil.
3. **Toda operación llama a una función de autorización antes de tocar datos.**
4. Un entrenador solo accede a clientes donde `trainer_id = su profileId`.
5. Un cliente solo accede a su propio `client`, resuelto por `profile_id`.
6. **Un cliente nunca puede editar, aprobar ni rechazar una versión.**
7. **Un cliente solo ve versiones en `SENT`.** Nunca un borrador.
8. **La pertenencia se verifica contra la identidad resuelta del webhook, nunca
   contra un ID recibido en la petición.** Cambiar un ID no da acceso a nada.
9. Todo intento denegado se registra con el `telegram_user_id`, sin datos.

## 5. Estados

No toca estados.

## 6. Errores

| Situación | Respuesta |
|---|---|
| Secreto de cabecera inválido | `401`, cero escrituras |
| `telegram_user_id` sin perfil | Mensaje neutro. No revela si existe |
| Entrenador pide un cliente ajeno | Denegado. Mismo mensaje que "no existe" |
| Cliente intenta aprobar | Denegado y registrado |
| Cliente pide una versión en `DRAFT` | Denegado. Mismo mensaje que "no existe" |

> **Denegado y no-existe dan la misma respuesta.** Si difirieran, un atacante
> podría enumerar recursos probando IDs.

## 7. Seguridad

Esta spec **es** la capa de seguridad de V1 (ADR-010). RLS deniega todo y las
Edge Functions usan `service_role`, así que estas funciones son lo único que
separa a un cliente de los datos de otro.

Por eso: **cobertura del 100% obligatoria**, incluidos todos los casos denegados.

## 8. Criterios de aceptación

- **CA-1** — DADO un update con secreto inválido, CUANDO llega, ENTONCES `401`
  y ninguna escritura.
- **CA-2** — DADO un `telegram_user_id` sin perfil, CUANDO escribe al bot,
  ENTONCES recibe un mensaje neutro y no se crea ningún perfil.
- **CA-3** — DADO el entrenador A, CUANDO pide un cliente del entrenador B,
  ENTONCES se deniega con el mismo mensaje que si no existiera.
- **CA-4** — DADO el cliente A, CUANDO pide la rutina del cliente B, ENTONCES
  se deniega.
- **CA-5** — DADO un cliente, CUANDO intenta aprobar una versión, ENTONCES se
  deniega y se registra el intento.
- **CA-6** — DADO un cliente, CUANDO pide una versión en `DRAFT` de su propio
  plan, ENTONCES se deniega: solo ve `SENT`.
- **CA-7** — DADO un `versionId` ajeno en un `callback_data`, CUANDO se procesa,
  ENTONCES se deniega por pertenencia, no por formato.
- **CA-8** — DADO un intento denegado, CUANDO se revisan los logs, ENTONCES
  aparece el `telegram_user_id` y **ningún dato del recurso**.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | Cada función de autorización: permitido y **cada** denegado |
| Unit | `canViewVersion` deniega al cliente todo lo que no sea `SENT` |
| Unit | Un cliente sin vincular (`profileId` NULL) no accede a nada |
| Unit | `resolveIdentity` con update válido, sin perfil y malformado |
| Integration | CA-1 a CA-7 |
| **Security** | Los 11 casos de `SECURITY.md` |

## 10. Archivos

```
supabase/functions/_core/domain/identity.ts
supabase/functions/_core/authorization.ts
supabase/functions/_core/authorization.test.ts
supabase/functions/_shared/telegram-identity.ts
tests/integration/security.test.ts
```
