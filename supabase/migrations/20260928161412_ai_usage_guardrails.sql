create schema if not exists private;

create table if not exists private.ai_rate_windows (
  user_id uuid not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, window_start)
);

create table if not exists private.ai_daily_usage (
  user_id uuid not null,
  usage_date date not null,
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  used_tokens bigint not null default 0 check (used_tokens >= 0),
  primary key (user_id, usage_date)
);

create table if not exists private.ai_monthly_usage (
  period_start date primary key,
  reserved_cost_microusd bigint not null default 0 check (reserved_cost_microusd >= 0),
  used_cost_microusd bigint not null default 0 check (used_cost_microusd >= 0)
);

create table if not exists private.ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  usage_date date not null,
  period_start date not null,
  reserved_tokens bigint not null check (reserved_tokens > 0),
  reserved_cost_microusd bigint not null check (reserved_cost_microusd >= 0),
  actual_tokens bigint,
  actual_cost_microusd bigint,
  provider text,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed'))
);

create index if not exists ai_usage_reservations_user_created_idx
  on private.ai_usage_reservations (user_id, created_at desc);

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_estimated_tokens bigint,
  p_estimated_cost_microusd bigint,
  p_requests_per_minute integer,
  p_daily_token_limit bigint,
  p_monthly_cost_limit_microusd bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_day date := (now() at time zone 'utc')::date;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_rate integer;
  v_daily bigint;
  v_monthly bigint;
  v_reservation uuid;
begin
  if p_estimated_tokens <= 0 or p_estimated_cost_microusd < 0 then
    raise exception using errcode = '22023', message = 'invalid reservation';
  end if;

  insert into private.ai_rate_windows (user_id, window_start, request_count)
  values (p_user_id, v_window, 1)
  on conflict (user_id, window_start) do update
    set request_count = private.ai_rate_windows.request_count + 1
  returning request_count into v_rate;

  if v_rate > p_requests_per_minute then
    raise exception using errcode = 'P0001', message = 'rate_limit_exceeded';
  end if;

  insert into private.ai_daily_usage (user_id, usage_date)
  values (p_user_id, v_day)
  on conflict do nothing;

  select reserved_tokens + used_tokens into v_daily
  from private.ai_daily_usage
  where user_id = p_user_id and usage_date = v_day
  for update;

  if v_daily + p_estimated_tokens > p_daily_token_limit then
    raise exception using errcode = 'P0001', message = 'daily_token_quota_exceeded';
  end if;

  insert into private.ai_monthly_usage (period_start)
  values (v_month)
  on conflict do nothing;

  select reserved_cost_microusd + used_cost_microusd into v_monthly
  from private.ai_monthly_usage
  where period_start = v_month
  for update;

  if v_monthly + p_estimated_cost_microusd > p_monthly_cost_limit_microusd then
    raise exception using errcode = 'P0001', message = 'monthly_spending_ceiling_exceeded';
  end if;

  update private.ai_daily_usage
  set reserved_tokens = reserved_tokens + p_estimated_tokens
  where user_id = p_user_id and usage_date = v_day;

  update private.ai_monthly_usage
  set reserved_cost_microusd = reserved_cost_microusd + p_estimated_cost_microusd
  where period_start = v_month;

  insert into private.ai_usage_reservations (
    user_id, usage_date, period_start, reserved_tokens, reserved_cost_microusd
  ) values (
    p_user_id, v_day, v_month, p_estimated_tokens, p_estimated_cost_microusd
  ) returning id into v_reservation;

  delete from private.ai_rate_windows
  where user_id = p_user_id and window_start < now() - interval '2 days';

  return v_reservation;
end;
$$;

create or replace function public.finalize_ai_usage(
  p_reservation_id uuid,
  p_status text,
  p_actual_tokens bigint default 0,
  p_actual_cost_microusd bigint default 0,
  p_provider text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.ai_usage_reservations%rowtype;
begin
  if p_status not in ('completed', 'failed') or p_actual_tokens < 0 or p_actual_cost_microusd < 0 then
    raise exception using errcode = '22023', message = 'invalid finalization';
  end if;

  select * into v_row from private.ai_usage_reservations
  where id = p_reservation_id for update;

  if not found or v_row.status <> 'reserved' then
    return;
  end if;

  update private.ai_daily_usage
  set reserved_tokens = greatest(0, reserved_tokens - v_row.reserved_tokens),
      used_tokens = used_tokens + case when p_status = 'completed' then p_actual_tokens else 0 end
  where user_id = v_row.user_id and usage_date = v_row.usage_date;

  update private.ai_monthly_usage
  set reserved_cost_microusd = greatest(0, reserved_cost_microusd - v_row.reserved_cost_microusd),
      used_cost_microusd = used_cost_microusd + case when p_status = 'completed' then p_actual_cost_microusd else 0 end
  where period_start = v_row.period_start;

  update private.ai_usage_reservations
  set status = p_status,
      actual_tokens = case when p_status = 'completed' then p_actual_tokens else 0 end,
      actual_cost_microusd = case when p_status = 'completed' then p_actual_cost_microusd else 0 end,
      provider = p_provider
  where id = p_reservation_id;
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, bigint, bigint, integer, bigint, bigint) from public, anon, authenticated;
revoke all on function public.finalize_ai_usage(uuid, text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, bigint, bigint, integer, bigint, bigint) to service_role;
grant execute on function public.finalize_ai_usage(uuid, text, bigint, bigint, text) to service_role;
