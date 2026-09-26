-- =============================================================================
-- SPEC-027 — El cliente actualiza sus datos
--
-- Hasta aquí, un segundo envío del formulario creaba un cliente NUEVO
-- (SPEC-001): no había forma de saber que era la misma persona. Ahora el bot
-- le da al cliente ya registrado un enlace de Tally con un token de un solo
-- uso, y la evaluación que llega con él es de ESE cliente.
--
-- ┌─ POR QUÉ EN `clients` Y NO EN UNA TABLA PROPIA ────────────────────────┐
-- │ Hay a lo sumo UN token vivo por cliente: pedir otro invalida el        │
-- │ anterior (regla 4). Dos columnas en la fila del cliente lo garantizan  │
-- │ por construcción, igual que `link_token` vive ahí.                     │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ POR QUÉ SE GUARDA EL HASH ────────────────────────────────────────────┐
-- │ El token permite reescribir la evaluación de un cliente, datos de      │
-- │ salud incluidos. Si se filtra la tabla, con el hash no se puede        │
-- │ reconstruir ningún enlace vivo. `sha256` es nativa desde PostgreSQL 11:│
-- │ no hace falta pgcrypto, y `_core` no necesita crypto.                  │
-- └────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

alter table clients
  add column update_token_hash       text unique,
  add column update_token_expires_at timestamptz,
  -- Los dos, o ninguno: un hash sin vencimiento valdría para siempre.
  add constraint clients_update_token_complete
    check ((update_token_hash is null) = (update_token_expires_at is null));

comment on column clients.update_token_hash is
  'sha256 (hex) del token de actualización de SPEC-027. El token nunca se guarda.';

-- El hash, en un solo sitio.
create function update_token_hash(p_token text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

revoke all on function update_token_hash from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Emitir: desde el botón del entrenador (regla 3)
--
-- La autorización (¿es su cliente?) la hace `_core` ANTES de llamar aquí.
-- Solo emite si el cliente está vinculado: sin chat no hay a quién mandarle
-- el enlace. Devuelve ese chat, o NULL si no se emitió nada.
-- -----------------------------------------------------------------------------
create function issue_update_token_for_client(p_client_id uuid, p_token text)
returns bigint
language sql
security invoker
as $$
  update clients c
     set update_token_hash       = update_token_hash(p_token),
         update_token_expires_at = now() + interval '7 days'
    from profiles p
   where c.id = p_client_id
     and p.id = c.profile_id
  returning coalesce(p.telegram_chat_id, p.telegram_user_id);
$$;

revoke all on function issue_update_token_for_client from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Emitir: desde `/actualizar`, que escribe el propio cliente (regla 1)
--
-- Recibe su PERFIL, no un id de cliente: no existe la forma de pedir el
-- enlace de otro, porque no hay dónde ponerlo. Devuelve el cliente, o NULL.
-- -----------------------------------------------------------------------------
create function issue_update_token_for_profile(p_profile_id uuid, p_token text)
returns uuid
language sql
security invoker
as $$
  update clients
     set update_token_hash       = update_token_hash(p_token),
         update_token_expires_at = now() + interval '7 days'
   where profile_id = p_profile_id
  returning id;
$$;

revoke all on function issue_update_token_for_profile from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Consumir: la evaluación nueva, para el cliente dueño del token
--
-- Todo o nada, y el token vale UNA vez: el UPDATE que lo borra es lo que
-- decide quién se lo queda. Dos envíos simultáneos con el mismo token no
-- pueden pasar los dos, porque el segundo ya no encuentra el hash.
--
-- Sin filas si el token no vale (inventado, usado o vencido): quien llama
-- sigue por el camino de siempre, cliente nuevo (SPEC-027 §8).
--
-- `previous` es la evaluación anterior, sin el payload crudo ni ids: con ella
-- `_core` dice qué campos cambiaron.
-- -----------------------------------------------------------------------------
create function ingest_assessment_update(
  p_token              text,
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
  p_gender             text default null,
  p_age                smallint default null,
  p_weight_kg          numeric default null,
  p_height_cm          smallint default null,
  p_last_weighed       text default null,
  p_quit_reasons       text default null,
  p_menopause_stage    text default null,
  p_chronic_conditions text default null,
  p_birth_date         date default null,
  p_medications        text default null,
  p_equipment_detail   text default null
)
returns table (
  client_id      uuid,
  client_name    text,
  client_chat_id bigint,
  assessment_id  uuid,
  previous       jsonb,
  plan_id        uuid,
  version_id     uuid,
  version_state  version_state
)
language plpgsql
security invoker
as $$
declare
  v_client_id     uuid;
  v_plan_id       uuid;
  v_previous_id   uuid;
  v_assessment_id uuid;
begin
  update clients c
     set update_token_hash = null, update_token_expires_at = null
   where c.update_token_hash = update_token_hash(p_token)
     and c.update_token_expires_at > now()
  returning c.id into v_client_id;

  if v_client_id is null then
    return;
  end if;

  -- El plan vigente: el más reciente del cliente.
  select pl.id, pl.assessment_id
    into v_plan_id, v_previous_id
    from workout_plans pl
   where pl.client_id = v_client_id
   order by pl.created_at desc
   limit 1
     for update;

  insert into assessments (
    client_id, raw_payload, goal, level, days_per_week, session_minutes,
    equipment, has_limitations, limitations_detail, lifestyle, notes,
    gender, age, weight_kg, height_cm, last_weighed, quit_reasons,
    menopause_stage, chronic_conditions, birth_date, medications,
    equipment_detail
  ) values (
    v_client_id, p_raw_payload, p_goal, p_level, p_days_per_week, p_session_minutes,
    p_equipment, p_has_limitations, p_limitations_detail, p_lifestyle, p_notes,
    p_gender, p_age, p_weight_kg, p_height_cm, p_last_weighed, p_quit_reasons,
    p_menopause_stage, p_chronic_conditions, p_birth_date, p_medications,
    p_equipment_detail
  )
  returning id into v_assessment_id;

  -- Regla 6: las próximas versiones se preparan y se validan contra los
  -- datos nuevos. Las versiones ya creadas no se tocan: su contenido es un
  -- snapshot.
  update workout_plans set assessment_id = v_assessment_id where id = v_plan_id;

  return query
    select
      c.id,
      c.full_name,
      coalesce(p.telegram_chat_id, p.telegram_user_id),
      v_assessment_id,
      (select to_jsonb(a) - 'raw_payload' - 'id' - 'client_id' - 'created_at'
         from assessments a where a.id = v_previous_id),
      v_plan_id,
      pl.current_version_id,
      v.state
    from clients c
    left join profiles         p  on p.id  = c.profile_id
    left join workout_plans    pl on pl.id = v_plan_id
    left join workout_versions v  on v.id  = pl.current_version_id
    where c.id = v_client_id;
end;
$$;

comment on function ingest_assessment_update is
  'SPEC-027: evaluación nueva para el cliente dueño del token. Sin filas si el token no vale.';

revoke all on function ingest_assessment_update from anon, authenticated;
