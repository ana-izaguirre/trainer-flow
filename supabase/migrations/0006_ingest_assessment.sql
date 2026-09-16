-- =============================================================================
-- SPEC-001 — La escritura del webhook de Tally, en una sola operación
--
-- Un envío del formulario produce CUATRO filas en tres tablas, más la primera
-- versión. supabase-js no hace transacciones de varias sentencias, así que si
-- esto viviera en TypeScript un fallo a mitad dejaría un cliente sin plan, o
-- un plan sin versión, y nadie se enteraría hasta que el entrenador abriera
-- la rutina.
--
-- Igual que `create_workout_version`: **esto NO contiene reglas de negocio.**
-- Los valores llegan ya validados por `_core/assessment/validate-assessment.ts`.
-- Aquí solo se aplican de forma atómica.
-- =============================================================================

create or replace function ingest_assessment(
  p_trainer_id         uuid,
  p_full_name          text,
  p_link_token         text,
  p_raw_payload        jsonb,
  p_goal               text,
  p_level              text,
  p_days_per_week      smallint,
  p_session_minutes    smallint,
  p_equipment          text,
  p_has_limitations    boolean,
  p_limitations_detail text default null,
  p_lifestyle          text default null,
  p_notes              text default null,
  p_request_id         uuid default null
)
returns table (
  client_id     uuid,
  assessment_id uuid,
  plan_id       uuid,
  version_id    uuid
)
language plpgsql
security invoker
as $$
declare
  v_client_id     uuid;
  v_assessment_id uuid;
  v_plan_id       uuid;
  v_version_id    uuid;
begin
  -- SPEC-001 regla 4: el formulario es onboarding, cada envío crea un cliente
  -- nuevo. No se busca uno existente: fusionar por nombre metería la lesión
  -- de un «Carlos» en la rutina de otro, y en silencio.
  insert into clients (trainer_id, full_name, link_token)
  values (p_trainer_id, p_full_name, p_link_token)
  returning id into v_client_id;

  insert into assessments (
    client_id, raw_payload, goal, level, days_per_week, session_minutes,
    equipment, has_limitations, limitations_detail, lifestyle, notes
  ) values (
    v_client_id, p_raw_payload, p_goal, p_level, p_days_per_week, p_session_minutes,
    p_equipment, p_has_limitations, p_limitations_detail, p_lifestyle, p_notes
  )
  returning id into v_assessment_id;

  insert into workout_plans (client_id, assessment_id)
  values (v_client_id, v_assessment_id)
  returning id into v_plan_id;

  -- SPEC-001 regla 7: la primera versión nace en NEW, con source='ai' y sin
  -- contenido. La IA todavía no corrió, y puede no correr nunca: desde NEW se
  -- puede cargar una plantilla o escribirla a mano.
  --
  -- `p_created_by` es el ENTRENADOR: el cliente no tiene perfil hasta que abre
  -- el deep link, y `created_by` referencia `profiles`.
  v_version_id := create_workout_version(
    v_plan_id, 'ai'::version_source, p_trainer_id, null, null, p_request_id
  );

  return query select v_client_id, v_assessment_id, v_plan_id, v_version_id;
end;
$$;

comment on function ingest_assessment is
  'Crea cliente, evaluación, plan y su primera versión en NEW. Todo o nada. No contiene reglas de negocio: los valores llegan validados por _core.';

revoke all on function ingest_assessment from anon, authenticated;
