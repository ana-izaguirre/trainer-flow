-- SPEC-016 — Lo que el entrenador pidió tras usar el sistema.
--
-- Todas nullable a propósito: un formulario viejo, o alguien que prefiere no
-- contestar, tiene que poder entrar igual (regla 1).

alter table assessments
  add column gender             text,
  add column age                smallint,
  add column weight_kg          numeric(5,2),
  add column height_cm          smallint,
  add column last_weighed       text,
  add column quit_reasons       text,
  add column menopause_stage    text,
  -- ┌─ ESTA COLUMNA NO VIAJA AL PROVEEDOR DE IA ──────────────────────────┐
  -- │ Traducir «diabetes tipo 2» en «intensidad moderada, sin series al   │
  -- │ fallo» es criterio clínico, y es el trabajo del entrenador. Que un  │
  -- │ modelo lo haga solo es lo que este sistema existe para impedir.     │
  -- │                                                                     │
  -- │ Además habla de terceros: «familia cercana» son personas que nunca  │
  -- │ llenaron un formulario.                                             │
  -- │                                                                     │
  -- │ Solo se enseña en la ficha 📄 (SPEC-016 §3.2).                      │
  -- └─────────────────────────────────────────────────────────────────────┘
  add column chronic_conditions text;

-- Rangos que atrapan un dedazo, no que juzguen a nadie.
alter table assessments
  add constraint assessments_age_range
    check (age is null or age between 10 and 120),
  add constraint assessments_weight_range
    check (weight_kg is null or weight_kg between 20 and 400),
  add constraint assessments_height_range
    check (height_cm is null or height_cm between 80 and 250);

comment on column assessments.chronic_conditions is
  'Enfermedades crónicas propias y familiares. NUNCA al prompt: solo la ficha del entrenador (SPEC-016 §3.2).';
comment on column assessments.age is
  'Una foto en la fecha de la evaluación, no una edad viva.';
