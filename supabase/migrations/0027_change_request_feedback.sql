-- =============================================================================
-- SPEC-030 — El cliente siempre sabe en qué está su pedido
--
-- Dos huecos de `change_requests` que esta migración cierra:
--
--   1. Pulsar «Pedir un cambio» dos veces mandaba DOS avisos al entrenador.
--      El `UNIQUE` parcial ya impedía la fila duplicada, pero `request_change`
--      no decía si había creado la fila o solo tocado la que ya existía, así
--      que el flujo avisaba siempre.
--
--   2. Un segundo mensaje del cliente, tras ya haber escrito uno, se perdía
--      en silencio: `add_change_comment` exigía que el comentario estuviera
--      vacío. Ahora se AÑADE, hasta 500 caracteres.
--
-- ┌─ `created` EN VEZ DE UNA COMPROBACIÓN PREVIA ──────────────────────────┐
-- │ Un `SELECT` antes del `INSERT` para decidir si avisar tiene la misma    │
-- │ carrera que ya resolvía el `UNIQUE`: dos pulsaciones simultáneas la     │
-- │ pasarían las dos. `created` sale del propio `INSERT ... ON CONFLICT`,   │
-- │ así que sigue siendo el índice quien decide, no una carrera nueva.      │
-- └────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

alter table change_requests
  add column asked_at timestamptz not null default now();

comment on column change_requests.asked_at is
  'Cuándo se le pidió texto al cliente por última vez sobre esta solicitud. '
  'Compite con checkins.sent_at para decidir a quién va un mensaje suelto '
  '(SPEC-010 regla 11, SPEC-030 regla 5).';

-- -----------------------------------------------------------------------------
-- request_change — ahora dice si CREÓ la fila
--
-- Sin motivo nuevo en una solicitud que ya estaba abierta: SPEC-030 regla 1
-- decidió no pisar lo que el cliente ya había elegido. Por eso pasa a ser
-- `do nothing`, no `do update`.
-- -----------------------------------------------------------------------------
drop function if exists request_change(uuid, uuid, change_reason, text);

create function request_change(
  p_version_id uuid,
  p_client_id  uuid,
  p_reason     change_reason,
  p_comment    text default null
)
returns table (id uuid, created boolean)
language sql
security invoker
as $$
  with ins as (
    insert into change_requests (version_id, client_id, reason, comment, state, asked_at)
    values (p_version_id, p_client_id, p_reason, p_comment, 'OPEN', now())
    on conflict (version_id) where state = 'OPEN' do nothing
    returning change_requests.id
  )
  select ins.id, true from ins
  union all
  select cr.id, false
    from change_requests cr
   where cr.version_id = p_version_id
     and cr.state = 'OPEN'
     and not exists (select 1 from ins);
$$;

comment on function request_change is
  'Crea la solicitud, o deja la abierta intacta. `created` dice cuál pasó: '
  'solo con created=true se avisa al entrenador (SPEC-030 regla 1 y 2).';

revoke all on function request_change from anon, authenticated;

-- -----------------------------------------------------------------------------
-- touch_change_request_ask — se volvió a pedir texto sobre una ya abierta
--
-- Cuando el cliente pulsa un motivo (o `/cambio`) con una solicitud ya
-- abierta, no se crea nada, pero el mensaje SÍ vuelve a invitarlo a escribir.
-- `asked_at` se actualiza igual: es lo que compara con el check-in (regla 5).
-- -----------------------------------------------------------------------------
create function touch_change_request_ask(p_request_id uuid, p_client_id uuid)
returns boolean
language sql
security invoker
as $$
  update change_requests
     set asked_at = now()
   where id = p_request_id
     and client_id = p_client_id
     and state = 'OPEN'
  returning true;
$$;

comment on function touch_change_request_ask is
  'Vuelve a marcar la solicitud como recién preguntada, sin tocar el motivo.';

revoke all on function touch_change_request_ask from anon, authenticated;

-- -----------------------------------------------------------------------------
-- add_change_comment — ahora AÑADE, no reemplaza
--
-- Antes exigía el comentario vacío: un segundo mensaje del cliente se perdía
-- en silencio (SPEC-030 diagnóstico #3). Ahora cada mensaje se concatena con
-- un salto de línea, hasta 500 caracteres — el mismo límite de siempre.
-- -----------------------------------------------------------------------------
drop function if exists add_change_comment(uuid, uuid, text);

create function add_change_comment(p_request_id uuid, p_client_id uuid, p_comment text)
returns table (saved boolean, truncated boolean)
language plpgsql
security invoker
as $$
declare
  v_actual uuid;
  v_previo text;
  v_nuevo  text;
begin
  select id, comment into v_actual, v_previo
    from change_requests
   where id = p_request_id
     and client_id = p_client_id
     and state = 'OPEN'
   for update;

  if v_actual is null then
    return query select false, false;
    return;
  end if;

  v_nuevo := case
    when v_previo is null or v_previo = '' then p_comment
    else v_previo || chr(10) || p_comment
  end;

  update change_requests set comment = left(v_nuevo, 500) where id = v_actual;

  return query select true, length(v_nuevo) > 500;
end;
$$;

comment on function add_change_comment is
  'Añade el mensaje al comentario de la solicitud abierta, hasta 500 '
  'caracteres. `truncated` dice si sobró texto (SPEC-030 regla 4).';

revoke all on function add_change_comment from anon, authenticated;

-- open_change_request_for_client ya devuelve asked_at (migración 0013):
-- solo cambia lo que representa, no su forma. Nada que migrar ahí.

-- -----------------------------------------------------------------------------
-- open_change_request_for_client — ahora también dice el motivo y desde
-- cuándo, para el mensaje de estado de SPEC-030 regla 1 y 6.
-- -----------------------------------------------------------------------------
drop function if exists open_change_request_for_client(uuid);

create function open_change_request_for_client(p_profile_id uuid)
returns table (
  request_id uuid,
  client_id  uuid,
  version_id uuid,
  reason     change_reason,
  has_comment boolean,
  asked_at   timestamptz,
  created_at timestamptz
)
language sql
security invoker
stable
as $$
  select r.id, r.client_id, r.version_id, r.reason, r.comment is not null, r.asked_at, r.created_at
    from change_requests r
    join clients c on c.id = r.client_id
   where c.profile_id = p_profile_id
     and r.state = 'OPEN'
   order by r.created_at desc
   limit 1;
$$;

comment on function open_change_request_for_client is
  'La solicitud abierta del cliente, con su motivo y desde cuándo (SPEC-030).';

revoke all on function open_change_request_for_client from anon, authenticated;
