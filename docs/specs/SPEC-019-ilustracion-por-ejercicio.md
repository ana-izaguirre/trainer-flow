# SPEC-019 — Una referencia visual por ejercicio

| Campo | Valor |
|---|---|
| **Estado** | APROBADA — pendiente de implementar |
| **Depende de** | SPEC-005 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que un cliente que no sabe qué es un «remo en punta» pueda verlo, sin sacarlo
de su chat ni inflarle la rutina.

## 2. La decisión de fondo: son ENLACES, no imágenes

Una rutina tiene ~12 ejercicios y la librería trae 3 fotogramas de cada uno.
Mandarlos serían **36 imágenes**.

Y la rutina es **un mensaje que el cliente relee toda la semana**. Con 36
fotos deja de servir para lo que sirve.

Por eso el nombre del ejercicio se vuelve **tocable** y lleva a su página,
que ya muestra los tres fotogramas:

```
• Peso muerto rumano — 3x8-10 · descanso 120s
  ↑ tocable → .../exercises/romanian-deadlift/
```

Cero imágenes enviadas, cero alojamiento, y **la longitud del mensaje no
cambia**: en MarkdownV2 el nombre *es* el enlace.

## 3. Dos capas, para que nadie se quede sin nada

```
¿El ejercicio está en la librería?
   SÍ  → su página: 3 fotogramas, exacta
   NO  → búsqueda en YouTube, ARMADA con el nombre
```

La búsqueda no la genera la IA: se construye con el nombre del ejercicio, así
que no hay nada que inventar y siempre devuelve algo relevante.

### Por qué la IA no genera enlaces de vídeo

El coste en tokens es irrelevante (~180 por rutina). El problema es que el
modelo **se inventa los identificadores**: produce URLs con buena pinta que
son 404 o, peor, un vídeo real que no corresponde.

**Y verificarlos no lo resuelve.** `youtube.com/oembed` dice si un vídeo
existe, pero un identificador válido que apunta a un vídeo de cocina pasa la
comprobación perfectamente. Verificar convierte «doce enlaces rotos» en «ocho
que abren y cuatro que faltan», y entre esos ocho algunos apuntan a lo que no
es. Ningún check automático lo detecta.

El problema no es que verificar sea caro: es que **desaparece** si el modelo
no genera identificadores.

## 4. La librería

[workout-guide](https://github.com/bryllim/workout-guide) — 302 ejercicios,
3 fotogramas cada uno (PNG y SVG), metadatos con slug, equipo y músculos.
**CC BY-SA 4.0.**

### La cobertura, medida y no supuesta

Se temía que un cliente sin equipo se quedara fuera. **Es al revés:**

| Equipo | Ejercicios |
|---|---|
| **Bodyweight** | **111** ← la categoría más grande |
| Dumbbell | 45 |
| Machine | 35 |
| Barbell | 29 |
| Cable | 26 |
| Resistance Band | 19 |
| Resto | 37 |

Probando 14 ejercicios de las plantillas actuales: **12 encontrados**. Los
dos que fallan —«flexiones inclinadas» y «dominadas lastradas»— **no son
categorías que falten, son variantes** de ejercicios que sí están.

### Por qué una variante NO cae a su ejercicio base

Tentador y equivocado. Enseñar `push-up` para «flexiones inclinadas» sería
engañoso: la inclinada es más fácil, y esa diferencia es justo el motivo de
haberla elegido. Una variante sin coincidencia exacta cae a la **búsqueda**,
no a su base.

## 5. Reglas

1. **Coincidencia exacta o nada.** El slug se valida contra la lista de 302.
   Uno inventado no llega jamás al cliente.
2. **Una variante sin coincidencia cae a la búsqueda**, nunca a su base (§4).
3. **Ningún ejercicio se queda sin referencia.** Si no hay slug, hay
   búsqueda; si el nombre está vacío, no hay enlace y se pinta como hoy.
4. **La longitud del mensaje no crece.** El nombre es el enlace.
5. **La atribución de CC BY-SA se cumple** con una línea en el mensaje o en
   `/ayuda`. Sirviendo las imágenes **sin modificar** no hay adaptación, así
   que ShareAlike no alcanza al código del proyecto.

## 6. El orden de implementación

**Primero las plantillas.** 38 ejercicios, tabla hecha a mano una vez,
cobertura completa, riesgo cero. Ya cubre toda rutina salida de plantilla.

**Después la IA.** Se le dan los 302 slugs y se le obliga a elegir uno o
`null`. Va segundo porque conviene tener datos de si acierta antes de
confiarle el enlace que ve el cliente.

## 7. Criterios de aceptación

- **CA-1** — DADO un ejercicio de la librería, CUANDO el cliente recibe la
  rutina, ENTONCES su nombre enlaza a la página con los tres fotogramas.
- **CA-2** — DADO uno que no está, ENTONCES enlaza a una búsqueda.
- **CA-3** — DADO un slug que no existe en la lista, ENTONCES **no** se usa,
  y se cae a la búsqueda.
- **CA-4** — DADO cualquier rutina, CUANDO se pinta, ENTONCES el mensaje cabe
  igual que hoy en el límite de Telegram.
- **CA-5** — DADO una variante sin coincidencia exacta, ENTONCES **no**
  enlaza a su ejercicio base.

## 8. La dependencia, dicha en voz alta

Los enlaces apuntan al GitHub Pages **de otra persona**. Si lo baja, mueren.

Es un sitio estático con licencia abierta: si pasa, se clona y se publica en
otro sitio. Medio día, y solo si pasa. Se anota aquí para que sea una
decisión y no una sorpresa.

## 9. Lo que queda para después

Las imágenes **dentro** del chat, bajo demanda: un botón «📸 Ver un
ejercicio» que liste los de esa rutina y mande el álbum o un GIF del elegido.
Un ejercicio a la vez, cuando el cliente lo pide — que es la única forma de
no ahogar la rutina.
