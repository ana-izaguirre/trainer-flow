# TrainerFlow — Producto

## Problema

Un entrenador personal pierde horas cada semana en trabajo repetitivo:
recopilar información de clientes, diseñar rutinas, adaptarlas, hacer
seguimiento y detectar quién necesita atención.

## Solución

TrainerFlow centraliza el flujo y automatiza la parte mecánica, manteniendo al
entrenador como responsable de la decisión final.

```
Cliente → Tally → TrainerFlow
                       ↓
     El entrenador crea la rutina de UNA de tres formas:
       · con IA        · desde una plantilla      · desde cero
                       ↓
              Revisa y edita en Telegram
                       ↓
              Aprueba / Rechaza
                       ↓
              El cliente la recibe por Telegram
                       ↓
        Check-in semanal  ·  puede pedir cambios
```

## Los dos principios

### 1. La IA propone, el entrenador decide

Gemini nunca envía una rutina al cliente sin aprobación humana explícita.

### 2. La IA es una capacidad, no la dueña del dominio

Las tres formas de crear una rutina producen el mismo tipo y pasan la misma
validación. **Si la IA se cae, el producto sigue funcionando**: el entrenador
usa una plantilla o escribe la rutina a mano.

El camino manual se construye **antes** que la IA, precisamente para que eso
sea cierto de verdad y no una intención.

## Usuario objetivo del MVP

Un entrenador personal (el esposo de Ana), sin conocimientos de programación,
con ~10 clientes.

## Interfaces

**Entrenador → Telegram.** No hay dashboard web en V1.

Botones sobre cada propuesta de rutina:

```
🏋️ Nueva rutina para Carlos

Objetivo: Ganancia muscular
Nivel: Intermedio
Días: 4
Equipamiento: Gimnasio

Día 1
- Press banca 4x8
- Remo 4x10

⚠️ Limitación: hombro

[✏️ Editar]  [✅ Aprobar]  [❌ Rechazar]
```

Comandos:

| Comando | Función |
|---|---|
| `/clientes` | Lista de clientes |
| `/cliente <nombre>` | Ficha, rutina actual y último check-in |
| `/pendientes` | Rutinas pendientes de revisión |
| `/checkins` | Check-ins pendientes |
| `/ayuda` | Comandos disponibles |

**Cliente → Telegram.** Se vincula al bot con un enlace único
(`t.me/<bot>?start=<token>`) que recibe al terminar el formulario.

## Formulario de evaluación (Tally)

Duración objetivo: 2–3 minutos. Opciones estructuradas siempre que se pueda.

Campos: nombre, objetivo, nivel, días por semana, minutos por sesión,
equipamiento, lesiones o limitaciones, detalle de limitaciones (opcional),
estilo de vida, información adicional.

## Versionado

Una rutina enviada **no se sobrescribe nunca**. Si hay que cambiarla, se crea
una versión nueva y la anterior queda intacta, con su contenido y su historial.

## Solicitudes de cambio

Tras recibir su rutina, el cliente puede aceptarla o pedir un cambio con un
motivo (muy difícil, muy fácil, sin equipo…) y un comentario opcional.
**El cliente nunca edita la rutina**: el entrenador recibe la solicitud y crea
la versión nueva.

## Resiliencia de IA

Si la IA no está disponible o se agota el límite de uso, el sistema avisa y el
entrenador continúa con una plantilla o a mano. **El sistema nunca queda
inutilizado por una dependencia externa.**

## Definition of Done

El MVP está terminado cuando este flujo funciona de extremo a extremo:

1. Cliente nuevo completa Tally.
2. Los datos quedan guardados.
3. Gemini genera un borrador.
4. El entrenador lo recibe en Telegram.
5. Puede editar, aprobar o rechazar.
6. Al aprobar, el cliente recibe la rutina por Telegram.
7. El cliente hace check-in semanal.
8. El entrenador consulta el progreso.

Y además: cuando Gemini falla, el entrenador recibe el aviso y puede seguir
trabajando en modo manual.

## Fuera de alcance en V1

Dashboard web · **Frontend de cualquier tipo** · App móvil · Pagos · RAG ·
Biblioteca avanzada de ejercicios · Analytics · Multi-entrenador ·
**Segundo proveedor de IA** · **Diffing entre versiones** · Cualquier
automatización sin supervisión humana.

Sobre el editor: reordenar y duplicar días con comandos de Telegram es
incómodo, así que se difiere. Con las plantillas como punto de partida, el
entrenador edita valores en vez de construir desde cero — que es el caso de uso
real.

## Restricciones

- Costo de infraestructura objetivo: **~$0/mes** (planes gratuitos).
- Disponibilidad de desarrollo: **~45 min/día**.
