begin;

do $$
declare
  v_crypto_schema name;
begin
  select n.nspname
    into v_crypto_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_crypto_schema is null then
    raise exception 'pgcrypto extension is not installed';
  end if;

  execute format(
    'alter function public.create_store_owner(text, text, text, text, text) set search_path to %I, public, auth',
    v_crypto_schema
  );
end
$$;

notify pgrst, 'reload schema';

commit;
