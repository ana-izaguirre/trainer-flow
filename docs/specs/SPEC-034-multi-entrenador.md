# SPEC-034 — Multi-entrenador (V2)

| Campo | Valor |
|---|---|
| **Estado** | **BORRADOR — incompleto a propósito.** Faltan decisiones de producto que no me corresponde tomar (ver §3). No se implementa en V1 (CLAUDE.md, "Qué NO construir en V1": Multi-entrenador) |
| **Depende de** | SPEC-009, SPEC-033 (si el panel existe, la vista agregada vive ahí) |
| **Sesiones** | Por asignar — ni siquiera el diseño está cerrado |

## 1. Objetivo (tentativo)

Que el sistema sirva a **más de un entrenador** sin que cada alta sea un
`insert` manual en la base (como es hoy, `docs/DEPLOY.md` paso 9), y sin que
el modelo de datos cambie — porque ya está preparado para esto.

## 2. Lo que ya existe y ayuda

El esquema **ya es multi-tenant en los datos**, aunque hoy lo use un único
entrenador:

- `profiles.role = 'trainer'` no tiene límite de cuántas filas puede haber.
- `clients`, `workout_versions`, `plans`... todas llevan `trainer_id`.
- `_core/authorization.ts` ya decide "esto es tuyo o no" por `trainer_id` en
  cada operación — no habría que inventar aislamiento, ya existe.

Lo que falta no es el modelo de datos. Es (a) una forma de dar de alta a un
entrenador nuevo sin tocar SQL a mano, y (b) decidir si varios entrenadores
se relacionan entre sí de alguna forma, o son compartimentos estancos.

## 3. Por qué esta spec está incompleta — y debe seguir así hasta que Ana responda

"Multi-entrenador" significa cosas muy distintas según el modelo de negocio,
y el código no puede adivinar cuál es:

| Pregunta | Por qué importa |
|---|---|
| **¿Entrenadores totalmente independientes** (cada uno con su propia cartera, cero relación entre ellos, solo comparten la misma instalación)**, o un equipo/estudio** (un gimnasio con varios entrenadores que SÍ comparten clientes o reportes)? | Lo primero es básicamente "repetir el alta manual, pero con un comando en vez de SQL" — chico. Lo segundo exige un concepto nuevo de "organización" por encima de `trainer_id`, permisos de quién ve el agregado de quién, y qué pasa si dos entrenadores atienden al mismo cliente. |
| **¿Un cliente pertenece a UN entrenador siempre, o puede reasignarse?** | Si se puede reasignar, hace falta una transición explícita (quién la autoriza, qué pasa con el histórico) — otra máquina de estados, no un `UPDATE`. |
| **¿Hay un rol por encima de "entrenador"** (dueño del estudio, admin) **que da de alta a los demás, o cada entrenador se auto-registra**? | Auto-registro abre una superficie nueva de seguridad que hoy no existe: nadie entra al sistema sin que alguien ya adentro lo invite (ver SPEC-009 §3, "no es auto-registro"). Resolver esto mal rompe ese principio para los clientes también, si se comparte código. |
| **¿El bot de Telegram es uno solo para todos los entrenadores, o cada uno tiene el suyo?** | Uno solo significa que el bot debe distinguir con qué entrenador habla cada mensaje más allá de "busco su `telegramUserId`" — hoy asume que quien le escribe y no es cliente, es EL entrenador (singular). |

Ninguna de estas tiene una respuesta "técnicamente correcta": son decisiones
de negocio. Por eso esta spec no propone un diseño cerrado — proponerlo sin
esas respuestas sería adivinar, y CLAUDE.md es explícito en que no se
construye (ni se diseña en detalle) sin que el problema esté claro primero.

## 4. Las dos formas más probables, sin comprometerse a ninguna

**Si es "independientes, solo comparten instalación":** un comando o
pantalla de alta (`/alta_entrenador`, o parte de SPEC-033) que haga el mismo
`insert` que hoy se hace a mano. Cambio chico, sin tocar el modelo de datos.

**Si es "equipo/estudio con vista agregada":** necesita una tabla
`organizations` (o similar) por encima de `profiles`, una forma de decidir
quién ve el agregado de quién, y probablemente vive en el panel web
(SPEC-033) como una vista adicional — nunca en Telegram, que ya está
diseñado alrededor de un entrenador hablándole a SUS clientes.

## 5. Qué no cambia, decida lo que decida esto

- Los dos principios no negociables (CLAUDE.md): la IA sigue sin poder
  aprobar nada, y sigue siendo una capacidad, no la dueña del dominio —
  ningún diseño de multi-entrenador toca esto.
- Un cliente sigue viendo y hablando solo con Telegram. Esta spec es sobre
  cómo se organizan los entrenadores entre sí, no sobre la experiencia del
  cliente.
- `_core/authorization.ts` sigue siendo la única capa real de permisos
  (ADR-010) — lo que cambie, cambia ahí, con el mismo 100% de cobertura
  obligatorio.

## 6. Por qué esto es V2 y no V1

CLAUDE.md lo lista explícito: "Multi-entrenador" está entre lo que no se
construye en V1. Hoy hay un entrenador real usando el sistema. Diseñar para
varios antes de saber si el modelo es "estudio" o "independientes" es
resolver un problema hipotético con una decisión que, mal tomada, es cara de
deshacer (sobre todo si involucra reasignar clientes entre entrenadores).

## 7. Siguiente paso

Esto no avanza a BORRADOR completo ni a APROBADA hasta que Ana responda la
tabla de §3. En ese momento esta spec se reescribe con un diseño real:
contratos, migraciones, criterios de aceptación — todo lo que hoy falta a
propósito.
