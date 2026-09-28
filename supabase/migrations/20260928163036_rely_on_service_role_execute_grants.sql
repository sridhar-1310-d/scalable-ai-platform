-- Authorization is enforced by EXECUTE grants: only service_role can call these
-- functions. PostgREST does not expose JWT claims through the legacy per-claim
-- setting consistently, so a second in-function claim check rejects valid calls.
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
    v_definition := regexp_replace(
      v_definition,
      E'\\n  v_role text := coalesce\\(current_setting\\(''request\\.jwt\\.claim\\.role'', true\\), ''''\\);',
      '',
      'g'
    );
    v_definition := replace(
      v_definition,
      E'  if v_role <> ''service_role'' then\n    raise exception using errcode = ''42501'', message = ''service_role required'';\n  end if;\n\n',
      ''
    );
    if position('service_role required' in v_definition) > 0 then
      raise exception 'failed to remove obsolete role check from %', v_signature;
    end if;
    execute v_definition;
  end loop;
end;
$$;
