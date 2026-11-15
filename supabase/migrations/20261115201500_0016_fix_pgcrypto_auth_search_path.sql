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
  execute format(
    'alter function public.verify_owner_pin(text, text, text) set search_path to %I, public, auth',
    v_crypto_schema
  );
  execute format(
    'alter function public.verify_owner_recovery_code(text, text, text) set search_path to %I, public, auth',
    v_crypto_schema
  );
  execute format(
    'alter function public.complete_owner_pin_recovery(text, text, text, text) set search_path to %I, public, auth',
    v_crypto_schema
  );
  if to_regprocedure('public.ensure_owner(text, text, text, text)') is not null then
    execute format(
      'alter function public.ensure_owner(text, text, text, text) set search_path to %I, public',
      v_crypto_schema
    );
  end if;
  if to_regprocedure('public.reset_owner_secret(text, text, text)') is not null then
    execute format(
      'alter function public.reset_owner_secret(text, text, text) set search_path to %I, public',
      v_crypto_schema
    );
  end if;
end
$$;

commit;
