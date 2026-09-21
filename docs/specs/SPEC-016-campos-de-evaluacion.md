# SPEC-016 — Campos nuevos de la evaluación

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-001, SPEC-015 |
| **Sesiones** | S-31 |

## 1. Objetivo

Recoger lo que el entrenador pidió tras usar el sistema, y decidir **campo por
campo** si llega a la IA o solo a la ficha que él lee.

## 2. Lo que se pidió

Género · edad · peso · altura · última vez que se pesó · por qué ha desistido
de entrenar · enfermedades crónicas propias y de familia cercana · objetivos
múltiples · y, en mujeres, la etapa menopáusica.

### Objetivos múltiples: no necesita código

`mapFormFields` ya une una selección múltiple en una sola línea
(`"Fuerza, Pérdida de grasa"`), que es como funciona hoy «Equipamiento
disponible». Y `goal` se valida como texto libre de 200 caracteres, sin lista
cerrada.

**Basta con cambiar la pregunta en Tally a selección múltiple.** No entra en
esta spec porque no hay nada que construir.

## 3. La decisión: qué llega a la IA

| Campo | Al prompt | A la ficha 📄 | Por qué |
|---|---|---|---|
| Fecha de nacimiento → edad derivada | ✅ | ✅ | Una edad se queda vieja; una fecha no |
| Peso, altura, último pesaje | ✅ | ✅ | Cambian volumen y selección |
| Género | ✅ | ✅ | Afecta la programación |
| Qué le cuesta más para mejorar | ✅ | ✅ | La rutina que se cumple es mejor que la óptima |
| Etapa menopáusica | ✅ | ✅ | Ver §3.1 |
| **Enfermedades crónicas y familiares** | ✅ | ✅ | Ver §3.2 |
| **Fármacos** | ✅ | ✅ | Ver §3.2 |

### 3.1 Por qué la etapa menopáusica sí

Es una **variable de programación**, no un diagnóstico: «postmenopáusica» se
traduce en más trabajo de fuerza por densidad ósea y más margen de
recuperación, que es práctica establecida y está en cualquier manual.

Sigue siendo dato íntimo hacia un proveedor externo. Si se quiere cambiar, es
**una línea** en `prompt-builder.ts`.

### 3.2 El contexto clínico SÍ va a la IA

**Decisión de Ana, tomada después de plantearle la alternativa.** La primera
versión de esta spec dejaba fuera las enfermedades y los fármacos; se cambió
a que la IA reciba todo.

**El seguro no se toca.** `DRAFT → SENT` sigue sin existir, así que el
entrenador aprueba cada rutina antes de que salga. Lo que cambia es que el
borrador que él revisa llega ya con el contexto tenido en cuenta.

Lo que hace que eso sea revisable y no una caja negra es el prompt: obliga al
modelo a **declarar en `warnings` una línea por cada cosa que tuvo en cuenta
y qué decidió por ella**. El entrenador pasa de auditar una rutina a revisar
decisiones.

Y le pone un límite explícito: *no des consejo médico, no sugieras cambiar ni
dejar un fármaco, no interpretes síntomas; solo programas entrenamiento.*

Sigue siendo dato sensible hacia un proveedor externo, y «familia cercana»
son datos de terceros. Queda escrito aquí para que la decisión sea visible, no
implícita.

## 4. Alcance

**Incluye:** las columnas, el mapeo, la validación, el prompt donde toca, y la
ficha de SPEC-015.

**No incluye:**
- Objetivos múltiples (§2: no hace falta).
- Calcular IMC o interpretar nada. El sistema guarda y enseña; quien
  interpreta es el entrenador.
- Hacer obligatorio ningún campo nuevo.

## 5. Reglas

1. **Todos los campos nuevos son opcionales.** Un formulario viejo, o alguien
   que prefiere no contestar, tiene que poder entrar igual.
2. **Un campo opcional que no llega NO es un error**, pero sí se anota: si el
   mapeo no encuentra una etiqueta —porque en Tally se llama distinto— el
   dato se pierde en silencio. El outcome `ingested` lleva `camposAusentes`
   con los NOMBRES, nunca los valores, y el handler ya loguea el outcome
   entero: una línea en vez de dos, bajo el mismo `requestId`.
3. **El contexto clínico llega al prompt acompañado de qué hacer con él.**
   «Diabetes» a secas deja que el modelo improvise. Hay test de que la
   sección aparece, de que exige declarar en `warnings`, y de que prohíbe dar
   consejo médico.
4. **Nada de esto va al aviso de nueva evaluación.** Ese se lee en la
   pantalla de bloqueo y sigue siendo un resumen. La ficha 📄 se pide.

4 bis. **La fecha de nacimiento manda sobre `age`.** La edad se deriva en SQL
   con `age` de respaldo, así que aguas abajo llega un solo valor.
5. **`weightKg` y `heightCm` se guardan como números**, no como texto: un
   «78,5 kg» y un «78.5» tienen que ser el mismo dato.
6. **La edad es una foto.** Se guarda junto a la fecha de la evaluación, que
   es lo que la hace interpretable dos años después.

## 6. Contratos

```sql
alter table assessments
  add column gender              text,
  add column age                 smallint,
  add column weight_kg           numeric(5,2),
  add column height_cm           smallint,
  add column last_weighed        text,
  add column quit_reasons        text,
  add column menopause_stage     text,
  -- Solo la ficha. NUNCA el prompt (§3.2).
  add column chronic_conditions  text;
```

Sin columna booleana para las enfermedades: `chronic_conditions is not null`
ya lo dice, y dos fuentes de la misma verdad acaban contradiciéndose.

## 7. Seguridad

`chronicConditions` es el dato más sensible que el sistema ha guardado, y
además habla de personas que no son el cliente.

- Nunca al prompt (regla 3, con test).
- Nunca al aviso (regla 4).
- Redactado en logs: el nombre normalizado contiene `chronic`, que se añade a
  los fragmentos prohibidos de `log-event.ts`.
- Solo en la ficha 📄, que ya comprueba pertenencia antes de enseñar un campo.

## 8. Criterios de aceptación

- **CA-1** — DADO un formulario con los campos nuevos, CUANDO entra,
  ENTONCES se guardan todos.
- **CA-2** — DADO un formulario sin ellos, CUANDO entra, ENTONCES la
  evaluación se ingiere igual.
- **CA-3** — DADO que faltan campos opcionales mapeados, CUANDO se procesa,
  ENTONCES sale `tally.campos_ausentes` con sus nombres y **ningún valor**.
- **CA-4** — DADO una evaluación con enfermedades o fármacos, CUANDO se arma
  el prompt, ENTONCES aparecen, con la instrucción de adaptar, declarar en
  `warnings` y no dar consejo médico.
- **CA-5** — DADO esa misma, CUANDO el entrenador pulsa 📄, ENTONCES **sí**
  las ve, con su aviso.
- **CA-6** — DADO `peso: "78,5"`, CUANDO se mapea, ENTONCES se guarda `78.50`.
- **CA-7** — DADO cualquier campo nuevo, CUANDO se loguea, ENTONCES
  `chronicConditions` sale redactado.

## 9. Archivos que toca

```
supabase/migrations/0016_assessment_fields.sql      nuevo
supabase/functions/_core/domain/assessment.ts       los campos
supabase/functions/_core/assessment/mapping.ts      las etiquetas de Tally
supabase/functions/_core/assessment/validate-assessment.ts
supabase/functions/_core/assessment/field-mapping.ts  decimales con coma
supabase/functions/_core/ai/prompt-builder.ts       los que SÍ van
supabase/functions/_core/assessment/intake.ts       todos
supabase/functions/_core/observability/log-event.ts 'chronic' prohibido
supabase/functions/_core/ports/intake-ports.ts
supabase/functions/_shared/db.ts
```

## 10. Las etiquetas hay que confirmarlas

El mapeo busca **por etiqueta**, así que las de `mapping.ts` tienen que
coincidir con las del formulario real. Van puestas como mejor conjetura y
marcadas.

Un envío de prueba con `scripts/simular-tally.sh` y la línea
`tally.campos_ausentes` dicen cuáles no cuadran. Ajustarlas es una línea cada
una.
