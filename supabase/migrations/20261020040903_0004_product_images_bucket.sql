/*
# Storage bucket: product-images

Creates a public bucket for product photos and grants anon/authenticated
insert + read access (single-tenant shared data). Uploads are scoped to a
`products/` prefix. Files are public so the app can render image_url directly.
*/

insert into storage.buckets (id, name, public)
select 'product-images', 'product-images', true
where not exists (select 1 from storage.buckets where id = 'product-images');

-- Public read
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

-- Insert (upload) for anon + authenticated (single-tenant shared)
drop policy if exists "product_images_insert" on storage.objects;
create policy "product_images_insert"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'product-images');

-- Update (replace) for anon + authenticated
drop policy if exists "product_images_update" on storage.objects;
create policy "product_images_update"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'product-images') with check (bucket_id = 'product-images');

-- Delete for anon + authenticated
drop policy if exists "product_images_delete" on storage.objects;
create policy "product_images_delete"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'product-images');
