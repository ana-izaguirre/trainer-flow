# SPEC-026 — El progreso del cliente, medido

| Campo | Valor |
|---|---|
| **Estado** | APROBADA — aprobada por Ana el 30/09/2026, pendiente de implementar. Confirmado: es distinta de SPEC-020 y SPEC-021 (§2), no se descarta |
| **Depende de** | SPEC-006, SPEC-016, SPEC-021 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Saber si el cliente **está progresando de verdad**, y no solo si cumple.

## 2. ⚠️ Tres cosas distintas que se llaman «progresión»

Esta spec existe porque «la progresión del cliente» puede significar tres
cosas, y dos ya estaban:

| | Qué responde | Dónde está |
|---|---|---|
| **Progresión de la rutina** | «¿Cuándo subo el peso?» | **SPEC-020** |
| **Historial de adherencia** | «¿Está cumpliendo?» | **SPEC-021** |
| **Progreso medido** | **«¿Está funcionando?»** | ⬅️ **esta** |

Las dos primeras pueden ir perfectas y la tercera ser un desastre: un cliente
que entrena las 4 sesiones, se siente bien, y lleva tres meses sin moverse ni
un gramo hacia su objetivo.

**Hoy nadie mira eso.** Los datos del cuerpo se capturan **una vez**, en el
formulario de admisión, y no se vuelven a tocar nunca.

> Si «progresión del cliente» significaba SPEC-020, esta spec se descarta y no
> se pierde nada.

## 3. El problema

```
Formulario   peso: 82 kg, altura: 175, objetivo: pérdida de grasa
     ↓
Semana 1..N  check-in: sesiones, sensación, molestias
     ↓
             ¿sigue pesando 82?  ← nadie lo sabe
```

El entrenador tiene el punto de partida y **ni una sola medición después**. La
pregunta que un cliente hace a los dos meses —«¿estoy avanzando?»— no tiene
respuesta en el sistema.

## 4. La decisión de diseño

### 4.1 Mensual, no semanal. Y esa es toda la spec

El check-in funciona porque son **tres toques**. Lo que lo mate, mata también
todo lo que depende de él.

```
Semanas 1, 2, 3   check-in normal      3 toques
Semana 4          + «¿Cuánto pesas?»   4 toques, una vez al mes
```

Una pregunta más, una vez de cada cuatro. Eso es lo que hace que esto sea
viable y que registrar el peso de cada ejercicio no lo sea (SPEC-020 §3.2).

### 4.2 Opcional siempre, y sin insistir

`[⏭️ Prefiero no decirlo]` está siempre. Pesarse es sensible, y un cliente que
se siente juzgado deja de contestar **el check-in entero**, no solo esa
pregunta.

Se pregunta una vez al mes. Si no contesta, **no se vuelve a preguntar hasta el
mes siguiente**. Sin recordatorios para esto.

### 4.3 La foto es opcional y va aparte

Una foto mensual dice más que el número, sobre todo en recomposición: el peso
no se mueve y el cuerpo sí.

Se guarda como en SPEC-025: **solo el `file_id`**, nunca el archivo. Y se ofrece
suelta, nunca como condición para responder lo demás.

### 4.4 La tendencia se lee contra el OBJETIVO

Un kilo menos no es bueno ni malo: depende de a qué vino.

```
Objetivo: pérdida de grasa   ·  peso baja   →  va bien
Objetivo: ganancia muscular  ·  peso baja   →  ⚡ mirar esto
Objetivo: fuerza             ·  peso baja   →  depende, es criterio suyo
```

Por eso esto alimenta las señales de SPEC-021 y **no se interpreta solo**.

## 5. Alcance

**Incluye:**
- La pregunta de peso en el check-in, **una vez cada 4 semanas**
- Foto de progreso opcional, por `file_id`
- La tendencia en el histórico de SPEC-021
- Dos señales nuevas: estancado, y moviéndose **contra** el objetivo

**No incluye:**
- Pesar cada semana. Ni el cuerpo cambia tan rápido ni el cliente aguanta
- Medidas de cintura, cadera, pliegues. Más preguntas, menos respuestas
- El peso levantado en cada ejercicio (descartado en SPEC-020 §3.2)
- Gráficas. Es texto en Telegram; las gráficas son del dashboard de V2
- Cualquier lectura automática de la foto. Nunca

## 6. Contratos

### Lo que se guarda

```sql
create table client_measurements (
  id          uuid        primary key default gen_random_uuid(),
  client_id   uuid        not null references clients (id) on delete cascade,
  checkin_id  uuid        references checkins (id) on delete set null,
  weight_kg   numeric,
  photo_id    text,
  created_at  timestamptz not null default now(),

  constraint measurements_something_recorded
    check (weight_kg is not null or photo_id is not null)
);
```

El `CHECK` es la regla en la base: **una fila vacía no es una medición.** Si el
cliente prefirió no decirlo, no hay fila — y «no contestó» se distingue de
«contestó 0».

### La pregunta, en la semana que toca

```
📊 Check-in semanal — semana 4

1️⃣ ¿Cuántas sesiones completaste?
2️⃣ ¿Cómo te sentiste?
3️⃣ ¿Alguna molestia?

4️⃣ Una vez al mes: ¿cuánto pesas?
    Escribe el número, o:
    [⏭️ Prefiero no decirlo]  [📷 Mandar foto]
```

### Lo que ve el entrenador

```
📈 Carlos Pérez — progreso

Inicio (12 ago)   82.0 kg
Semana 4          81.2 kg   ↓ 0.8
Semana 8          80.5 kg   ↓ 0.7
Semana 12         80.4 kg   ↓ 0.1

Objetivo: pérdida de grasa
⚡ Casi parado el último mes
```

## 7. Reglas de negocio

1. Se pregunta **cada 4 semanas**, contadas desde `sent_at` del plan.
2. **Siempre opcional.** Saltarla no deja el check-in incompleto ni dispara
   recordatorio.
3. Un peso fuera de **30–300 kg** se rechaza pidiéndolo otra vez. Es un dedazo,
   no una medición.
4. **Se guarda lo que el cliente dice, sin corregirlo.** Si se pesó vestido, es
   su dato; el entrenador lo interpreta.
5. La medición inicial es la del formulario (SPEC-016). **No se vuelve a
   preguntar el primer mes**: ya se sabe.
6. La foto es un `file_id` (SPEC-025 §3.1). **El archivo no se guarda nunca.**
7. **Nada de esto lo mira la IA.** Ni el peso al generar, ni la foto jamás.
8. Las señales nuevas **no disparan nada** (SPEC-021 §3.1): se ven cuando el
   entrenador pide el histórico.
9. Sin objetivo conocido, se muestra la tendencia **sin juzgarla**.

## 8. Las dos señales nuevas

| Señal | Se dispara cuando | Umbral |
|---|---|---|
| `STALLED` | Dos mediciones seguidas sin cambio apreciable | ±0.5 kg |
| `AGAINST_GOAL` | Se mueve al revés del objetivo declarado | 2 mediciones |

Los umbrales, como los de SPEC-021, **son provisionales y viven en la misma
constante**.

`AGAINST_GOAL` es la valiosa: un cliente que viene a ganar músculo y lleva dos
meses bajando está comiendo mal, entrenando mal, o pasando algo que hay que
preguntar. **Y hoy eso es invisible.**

## 9. Estados

**Ninguno.** No toca `version_state` ni `checkins.state`. Tabla propia.

## 10. Seguridad

> **El peso y las fotos de progreso son datos personales sensibles.** De lo más
> sensible que toca este sistema.

- El peso **no se loguea nunca**. Ni el `photo_id`: quien lo tenga descarga la
  foto.
- Solo el entrenador **de ese cliente** los ve.
- No se guarda ninguna imagen: **si esta base se filtrara, no habría ni una
  foto dentro.**
- No pasan por la IA (regla 7).
- Un cliente puede negarse, siempre, sin consecuencia (regla 2).

## 11. Criterios de aceptación

- **CA-1** — DADO la semana 4, CUANDO se manda el check-in, ENTONCES incluye la
  pregunta de peso.
- **CA-2** — DADO las semanas 1, 2, 3, 5, CUANDO se manda, ENTONCES **no** la
  incluye.
- **CA-3** — DADO que el cliente responde `81.2`, CUANDO se guarda, ENTONCES
  queda la medición y el peso **no aparece en ningún log**.
- **CA-4** — DADO que pulsa «Prefiero no decirlo», CUANDO se procesa, ENTONCES
  **no se crea ninguna fila** y el check-in se da por completo.
- **CA-5** — DADO un peso de `815`, CUANDO llega, ENTONCES se rechaza pidiendo
  el número otra vez.
- **CA-6** — DADO 82.0 → 81.9 → 81.8, CUANDO se calculan señales, ENTONCES sale
  `STALLED`.
- **CA-7** — DADO objetivo «ganancia muscular» y peso bajando dos veces
  seguidas, ENTONCES sale `AGAINST_GOAL`.
- **CA-8** — DADO un cliente sin objetivo declarado, CUANDO se formatea,
  ENTONCES sale la tendencia **sin ninguna señal**.
- **CA-9** — DADO una medición, CUANDO se guarda, ENTONCES **ningún
  `version_state` cambia**.

## 12. Tests

| Nivel | Caso |
|---|---|
| Unit | `shouldAskWeight` en las semanas 1 a 12 |
| Unit | Parseo del peso: enteros, decimales, coma, `81,2 kg`, fuera de rango |
| Unit | `STALLED` y `AGAINST_GOAL` en su umbral y justo por debajo |
| Unit | Sin objetivo → tendencia sin señal |
| Unit | Formateo de la tendencia, con una sola medición y con ninguna |
| Integration | El `CHECK` rechaza una fila sin peso ni foto |
| Security | Ni el peso ni el `photo_id` salen en los logs |
| E2E | Semana 4 → responde → aparece en el histórico |

## 13. Archivos que toca

```
supabase/migrations/00XX_client_measurements.sql   la tabla
supabase/functions/_core/checkin/schedule.ts       cuándo preguntar
supabase/functions/_core/checkin/answers.ts        el campo nuevo
supabase/functions/_core/history/signals.ts        las dos señales
supabase/functions/_core/history/format.ts         la tendencia
docs/specs/SPEC-006-checkin-semanal.md             la pregunta mensual
docs/specs/SPEC-021-historico-del-cliente.md       las señales nuevas
```

## 14. Lo que hay que decidir antes

1. **¿Cada 4 semanas, o cada 2?** Cuatro protege el check-in; dos da una línea
   de tendencia más útil. Es de Carlos.
2. **¿La foto entra en V1 o solo el número?** El número es una pregunta; la
   foto arrastra toda la §10.
3. **¿±0.5 kg es «estancado»?** Depende del objetivo, y hoy es una conjetura.
