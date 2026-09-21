# SPEC-018 — Las preferencias del entrenador en el prompt

| Campo | Valor |
|---|---|
| **Estado** | APROBADA — pendiente de implementar |
| **Depende de** | SPEC-002, SPEC-016 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que el criterio del entrenador entre en **todas** las generaciones, sin que
tenga que repetirlo cada vez.

## 2. El problema

Hoy el prompt sabe todo del cliente y **nada del entrenador**. Dos
entrenadores con el mismo formulario reciben la misma rutina.

Pero cada uno tiene su forma de trabajar:

> *«Nunca peso muerto convencional a principiantes.»*
> *«Siempre empieza con cinco minutos de movilidad.»*
> *«Nada de series al fallo por debajo de intermedio.»*

Sin esto, él corrige lo mismo en cada borrador. Es el trabajo que la
herramienta debería quitarle, no darle.

## 3. Lo que NO es

**No es un prompt que él escriba entero.** Eso le entregaría las reglas de
salida —el formato JSON, el número de días, los límites— y un error suyo
rompería la generación sin que sepa por qué.

Son **sus reglas de entrenamiento**, que el sistema coloca donde toca.

## 4. Alcance

**Incluye:** una lista de reglas en texto, editables desde Telegram, que se
inyectan en cada prompt.

**No incluye:**
- Reglas por cliente. Son del entrenador, no del caso.
- Reglas condicionales («si es mayor de 60 entonces…»). El texto libre ya lo
  expresa y el modelo lo entiende.
- Tocar las reglas de salida ni el esquema.

## 5. Reglas

1. **Van antes de las reglas de salida**, como todo lo demás. Si una
   preferencia dijera «devuelve texto plano», el formato manda igual.
2. **Son instrucciones, no datos.** Van bajo un encabezado que lo dice:
   *«Criterio del entrenador — respétalo salvo que choque con la seguridad
   del cliente.»*
3. **La seguridad del cliente gana.** Si una preferencia choca con una
   limitación declarada, manda la limitación, y el modelo lo declara en
   `warnings`. Una preferencia es una costumbre; una hernia, no.
4. **Sin preferencias, el prompt sale como hoy.** Ni encabezado vacío ni
   línea de más.
5. **Un límite de caracteres**, y visible al editarlas: sin tope, el prompt
   crece hasta desplazar lo que importa.
6. **Solo suyas.** Comprobación de pertenencia antes de leerlas.

## 6. Criterios de aceptación

- **CA-1** — DADO que tiene preferencias, CUANDO se genera, ENTONCES
  aparecen en el prompt bajo su encabezado.
- **CA-2** — DADO que no tiene ninguna, CUANDO se genera, ENTONCES el prompt
  es idéntico al de hoy.
- **CA-3** — DADO una preferencia que dice «ignora el formato», CUANDO se
  genera, ENTONCES las reglas de salida siguen después y mandan.
- **CA-4** — DADO que se pasa del límite, CUANDO intenta guardar, ENTONCES
  se rechaza diciendo cuánto sobra.
- **CA-5** — DADO otro entrenador, CUANDO se genera para su cliente,
  ENTONCES no se le aplican preferencias ajenas.

## 7. Por qué esta spec vale más que parecer un detalle

Es lo que separa «una IA que escribe rutinas» de «una IA que escribe **sus**
rutinas». El cliente no nota la diferencia leyendo una; la nota después de
tres, cuando todas se parecen a lo que su entrenador le habría dado.

Y reduce el trabajo de revisión, que es el cuello de botella real del
sistema: cuanto menos tenga que corregir, más rápido aprueba.

## 8. Archivos que toca

```
supabase/migrations/00XX_trainer_prefs.sql
supabase/functions/_core/ports/ai-provider.ts     AIRequest gana las reglas
supabase/functions/_core/ai/prompt-builder.ts     dónde van
supabase/functions/_core/commands/                verlas y editarlas
supabase/functions/_shared/db.ts
```
