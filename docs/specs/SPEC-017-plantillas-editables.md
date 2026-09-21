# SPEC-017 — Plantillas editables desde la base

| Campo | Valor |
|---|---|
| **Estado** | APROBADA — pendiente de implementar |
| **Depende de** | SPEC-008 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que el entrenador cambie una plantilla **al momento**, sin que nadie toque el
código ni haya que desplegar.

## 2. El problema

`_core/templates.ts` son 345 líneas de constante. Cambiar una repetición
exige un programador y un despliegue.

## 3. La tensión que hay que resolver

El propio archivo explica por qué vive en código:

> *«Son la garantía de que la IA no es punto único de fallo. Estando en el
> binario funcionan aunque la base de datos esté degradada: cero migración,
> cero consulta.»*

Moverlas a la base **rompe esa garantía**: si la base se cae, se cae también
el camino que existía para cuando la IA falla.

### La salida: la base manda, el código respalda

```
¿La base responde y tiene plantillas?
   SÍ  → se usan las suyas        ← editables al momento
   NO  → las cuatro del código    ← el suelo que nunca desaparece
```

Las del código dejan de ser «las plantillas» y pasan a ser **el suelo**. Se
mantienen como están y se usan como semilla en la primera migración.

Así se gana lo editable sin perder lo que la constante garantizaba. Sin esto,
la spec cambia una propiedad buena por otra, y eso no es una mejora.

## 4. Alcance

**Incluye:** tabla, lectura con respaldo, y edición desde Telegram.

**No incluye:**
- Un editor visual. Se edita por comandos, como el editor de borradores.
- Plantillas por cliente. Son del entrenador.
- Compartirlas entre entrenadores. No hay multi-entrenador en V1.

## 5. Reglas

1. **Una plantilla inválida no se puede guardar.** Pasa por `validateDraft`
   igual que una rutina, al guardarla y no al usarla: descubrirla rota el día
   que la IA falló sería el peor momento posible.
2. **Si la base no responde, se usan las del código.** En silencio para el
   entrenador, pero con una línea de log: que funcione degradado no quita que
   haya que enterarse.
3. **Editar una plantilla NO toca las rutinas ya creadas.** Se copió su
   contenido al cargarla; la plantilla es un molde, no un vínculo.
4. **Nunca se queda sin plantillas.** Si borra todas, vuelven las del código.
5. **Solo su dueño las ve y las edita**, comprobado antes de leer, como todo
   lo alcanzable desde Telegram (SPEC-013 regla 1).

## 6. Criterios de aceptación

- **CA-1** — DADO que edita una plantilla, CUANDO la guarda, ENTONCES la
  siguiente vez que pulse 📋 aparece la suya. Sin despliegue.
- **CA-2** — DADO que la base no responde, CUANDO pulsa 📋, ENTONCES salen
  las cuatro del código y queda una línea de log.
- **CA-3** — DADO una plantilla con 0 días, CUANDO intenta guardarla,
  ENTONCES se rechaza diciendo qué falla.
- **CA-4** — DADO una rutina creada desde una plantilla, CUANDO la plantilla
  cambia, ENTONCES esa rutina sigue byte a byte igual.
- **CA-5** — DADO que borra todas, CUANDO pulsa 📋, ENTONCES siguen
  saliendo las del código.
- **CA-6** — DADO otro entrenador, CUANDO pide una plantilla ajena,
  ENTONCES no la recibe.

## 7. Archivos que toca

```
supabase/migrations/00XX_templates.sql     tabla + semilla desde el código
supabase/functions/_core/ports/template-ports.ts
supabase/functions/_core/templates.ts      pasa a ser el RESPALDO
supabase/functions/_core/creation/flows.ts lee de la base, cae al código
supabase/functions/_shared/db.ts
```

## 8. Lo que decide si vale la pena

Que la use unas semanas. Si son dos retoques, sale más barato pedirlos. Si la
va a estar tocando seguido, esta spec se paga sola.
