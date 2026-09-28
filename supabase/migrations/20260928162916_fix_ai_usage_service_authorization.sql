-- PostgREST exposes JWT claims as a JSON object on current versions. Update the
-- already-deployed functions while keeping the first migration correct for new installs.
do $$
declare
  v_definition text;
  v_signature text;
begin
  foreach v_signature in array array[
    'public.reserve_ai_usage(uuid,bigint,bigint,integer,bigint,bigint)',
    'public.finalize_ai_usage(uuid,text,bigint,bigint,text)'
  ]
  loop
    select pg_get_functiondef(v_signature::regprocedure::oid) into v_definition;
    v_definition := replace(
      v_definition,
      'coalesce(current_setting(''request.jwt.claim.role''::text, true), ''''::text)',
      'coalesce(current_setting(''request.jwt.claims''::text, true)::jsonb ->> ''role''::text, ''''::text)'
    );
    execute v_definition;
  end loop;
end;
$$;
