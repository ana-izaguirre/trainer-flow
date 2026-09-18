# SPEC-013 — Tests de seguridad

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-008, SPEC-009 |
| **Sesiones** | S-27 |

## 1. Objetivo

Poner en verde los **11 casos obligatorios** de `docs/SECURITY.md`, en un solo
archivo que se lea como lo que es: la lista de lo que un atacante no puede
hacer.

## 2. El hallazgo que motiva la spec

`_core/telegram/webhook.ts` describe bien el modelo de amenaza:

```typescript
// El `callback_data` es dato NO confiable: cualquiera puede fabricar uno.
// Lo que impide tocar la versión de otro no es este parseo, sino la
// comprobación de pertenencia que hace `handleAction`.
```

Y treinta líneas más abajo, **tres flujos esquivan `handleAction`**:

```typescript
} else if (payload !== null && (payload.action === 'template' || payload.action === 'manual')) {
  creation =
    payload.action === 'template'
      ? await listTemplates(payload.versionId, identity.telegramChatId, deps.creation)
      : await startManual(payload.versionId, identity.telegramChatId, deps.creation);
}
```

`identity` entra **solo por su `chatId`**. Ni el rol ni la pertenencia se
miran. Y el tercero, `loadTemplate`, va por la misma puerta.

### Lo que permite

`startManual` y `loadTemplate` llaman a `fillVersion`, que **escribe contenido
y mueve la versión a `DRAFT`**.

| Quién | Qué manda | Qué consigue |
|---|---|---|
| Un cliente vinculado | `act:manual:<id ajeno>` | Sobrescribe la rutina de otro cliente y la deja en `DRAFT` |
| Un cliente vinculado | `act:template:<id ajeno>` | Lee el nombre del otro cliente: *«📋 Plantillas para Carlos»* |
| Un cliente vinculado | `tpl:<plantilla>:<id ajeno>` | Le carga una plantilla a otro |

Un `callback_data` no se fabrica desde la app oficial, pero **la API de bots no
es la app oficial**: el dato viaja desde el cliente y el sistema lo trata como
lo que es —no confiable— en todos los caminos menos estos tres.

Esto incumple dos de los once casos:

- **Caso 5** — «Cliente no puede modificar una versión.»
- **Caso 7** — «Cambiar un ID en la petición no da acceso ajeno.»

### Por qué no lo atrapó ningún test

`_core/authorization.ts` está al 100%, casos denegados incluidos. Lo que
ninguna prueba comprobaba es **si alguien lo llama**. `canModifyVersion` tiene
un solo sitio de uso; `canViewClient` y `canManageClient`, ninguno.

Es el mismo patrón de siempre en este proyecto: la regla existe, el camino no
la usa, y cada capa pasa sus tests por separado.

### La causa de fondo

`version_for_creation` **no devuelve la pertenencia**:

```sql
create function version_for_creation(p_version_id uuid)
returns table (
  version_id uuid, state version_state, client_name text, version_number smallint,
  days_per_week smallint, level text, equipment text, has_limitations boolean
)
```

No es que el código olvidara comprobar: **el dato para comprobar nunca se
cargó.** `version_for_action`, que sí autoriza, trae `trainer_id` y
`client_profile_id`. Por eso la corrección empieza en SQL.

## 2 bis. Un segundo hallazgo: «cero secretos en git» no se comprobaba

El job del CI se llama **Scan the history** y no la escanea:

```bash
git grep -rniE "$pattern" -- ':!pnpm-lock.yaml'
```

`git grep` sin revisión mira el **árbol de trabajo**. Un secreto commiteado y
luego borrado del archivo pasa el CI mientras sigue en el historial, legible
para cualquiera que clone. Borrar un secreto de un archivo no lo des-filtra.

Comprobado en un repo de prueba: commit con la clave → borrado → el job pasa.
Con `git rev-list --all` lo encuentra.

Se corrige en el CI. La salida se captura en una variable en vez de usarse
como condición del `if`, porque `xargs` puede partir en varios lotes y solo
sobreviviría el código de salida del último.

Con la corrección, el historial real de este repositorio sale limpio.

## 3. Alcance

**Incluye:**
- Cerrar el bypass de §2 en los tres flujos de creación.
- `tests/integration/security.test.ts` con los 11 casos.

**No incluye:**
- Rate limiting por usuario ni protección contra fuerza bruta (post-V1).
- Rotación de secretos.
- Cambiar RLS: sigue deny-all a propósito (ADR-010).

## 4. La corrección

1. **Migración 0014** — `version_for_creation` devuelve además `client_id`,
   `trainer_id` y `client_profile_id`. Hay que `drop` antes de recrear:
   `create or replace` no puede cambiar el tipo de retorno.
2. **`VersionForCreation` gana `client: ClientRef`**, igual que
   `VersionForAction`.
3. **Los tres flujos reciben `actor: Identity`** y llaman a
   `canModifyVersion` antes de tocar nada.
4. **El webhook pasa `identity` entera**, no solo su `chatId`.

## 5. Reglas

1. **Ningún flujo alcanzable desde `callback_data` actúa sobre un recurso sin
   comprobar pertenencia.** Sin excepciones por «ese botón solo lo tiene el
   entrenador»: el botón no es la frontera.
2. **La negación es indistinguible de «no existe».** Un atacante no aprende si
   el id que probó es real (SPEC-009 regla 9).
3. **Una negación no escribe nada**, ni siquiera un evento sobre el recurso
   ajeno: sería dejar que un extraño ensucie el historial de otro.
4. **La comprobación va antes de la primera escritura**, no entre medias.

## 6. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Cliente pide `tpl:`/manual sobre versión ajena | Mensaje neutro | Cero escrituras |
| Entrenador sobre versión de otro entrenador | Mensaje neutro | Cero escrituras |
| La versión no existe | El **mismo** mensaje neutro | Cero escrituras |

## 7. Criterios de aceptación

Los 11 de `SECURITY.md`, más los que abre el hallazgo:

- **CA-1** — Petición sin firma válida → rechazada, cero escrituras.
- **CA-2** — `chat_id` desconocido → ignorado y registrado.
- **CA-3** — Entrenador A no accede a clientes de entrenador B.
- **CA-4** — Cliente A no accede a datos de cliente B.
- **CA-5** — Cliente no puede modificar una versión. **Incluye los tres
  caminos de creación.**
- **CA-6** — Cliente no ve versiones que no estén en `SENT`.
- **CA-7** — Cambiar un ID en la petición no da acceso ajeno. **Incluye
  `act:manual:`, `act:template:` y `tpl:`.**
- **CA-8** — `anon` no lee ninguna tabla.
- **CA-9** — `anon` no ejecuta las funciones atómicas.
- **CA-10** — Datos inválidos rechazados por `CHECK`.
- **CA-11** — Ningún secreto aparece en logs ni en respuestas.
- **CA-12** — Una negación produce el mismo mensaje que un id inexistente.

## 8. Tests

| Nivel | Casos |
|---|---|
| Unit | CA-5, CA-7, CA-12 sobre los tres flujos de creación |
| Unit | El webhook enruta con `identity`, no solo con `chatId` |
| Integration | CA-3, CA-4, CA-6, CA-8, CA-9, CA-10 contra PostgreSQL |
| Integration | La migración 0014 devuelve la pertenencia |
| Deno | CA-1, CA-2 en la frontera HTTP |
| Unit | CA-11 sobre `formatLogLine` |

## 9. Archivos que toca

```
supabase/migrations/0014_creation_ownership.sql      nuevo
supabase/functions/_core/ports/creation-ports.ts     VersionForCreation gana client
supabase/functions/_core/creation/flows.ts           actor + canModifyVersion
supabase/functions/_core/telegram/webhook.ts         pasa identity
supabase/functions/_shared/db.ts                     mapea las columnas nuevas
tests/integration/security.test.ts                   nuevo: los 11 casos
tests/helpers/db.ts                                  código 22P02
.github/workflows/ci.yml                             el escaneo sí mira el historial
```

## 10. Lo que esta spec NO hace

- No añade RLS real. Con `service_role` en todo, RLS no protege nada: la capa
  real es `_core/authorization.ts` (ADR-010).
- No toca `trainer_client_detail`, que no recibe `trainer_id` pero solo se
  alcanza con ids de una lista ya filtrada. Queda anotado en el backlog como
  defensa en profundidad, no como agujero.
