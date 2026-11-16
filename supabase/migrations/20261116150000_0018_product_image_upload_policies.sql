begin;

drop policy if exists product_images_insert_tenant on storage.objects;
drop policy if exists product_images_update_tenant on storage.objects;
drop policy if exists product_images_delete_tenant on storage.objects;

create policy product_images_insert_tenant on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1
      from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  );
create policy product_images_update_tenant on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1
      from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  )
  with check (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1
      from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  );
create policy product_images_delete_tenant on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and name ~ '^products/[0-9a-fA-F-]{36}/'
    and exists (
      select 1
      from public.products p
      where p.id = split_part(name, '/', 2)::uuid
        and public.is_store_member(p.store_id)
    )
  );

notify pgrst, 'reload schema';

commit;
