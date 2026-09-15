# TrainerFlow — Producto

## Problema

Un entrenador personal pierde horas cada semana en trabajo repetitivo:
recopilar información de clientes, diseñar rutinas, adaptarlas, hacer
seguimiento y detectar quién necesita atención.

## Solución

TrainerFlow centraliza el flujo y automatiza la parte mecánica, manteniendo
al entrenador como responsable de la decisión final.

```
Cliente → Tally → TrainerFlow → Gemini genera borrador
                                       ↓
                        Entrenador revisa en Telegram
                                       ↓
                        Editar / Aprobar / Rechazar
                                       ↓
                        Cliente recibe rutina por Telegram
                                       ↓
                             Check-in semanal
```

## Principio fundamental

**La IA propone, el entrenador decide.**

Gemini nunca envía una rutina al cliente sin aprobación humana explícita.

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

## Resiliencia de IA

Si Gemini no está disponible o se agota el límite de uso, el sistema avisa y
el entrenador continúa creando rutinas manualmente. **El sistema nunca queda
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

Dashboard web · App móvil · Pagos · RAG · Biblioteca avanzada de ejercicios ·
Analytics · Multi-entrenador complejo · Cualquier automatización sin
supervisión humana.

## Restricciones

- Costo de infraestructura objetivo: **~$0/mes** (planes gratuitos).
- Disponibilidad de desarrollo: **~45 min/día**.
