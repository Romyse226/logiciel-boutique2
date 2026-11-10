begin;

alter table public.products
  add column if not exists initial_stock_qty numeric(14,3);

do $$
declare
  v_product_id uuid;
begin
  with sale_totals as (
    select product_id, sum(stock_decrement) as quantity
    from public.sale_items
    group by product_id
  ),
  movement_totals as (
    select product_id, sum(abs(delta)) as quantity
    from public.stock_movements
    where reason = 'sale'
      and sale_id is not null
    group by product_id
  )
  select coalesce(s.product_id, m.product_id)
    into v_product_id
  from sale_totals s
  full join movement_totals m on m.product_id = s.product_id
  where abs(coalesce(s.quantity, 0) - coalesce(m.quantity, 0)) > 0.001
  limit 1;

  if v_product_id is not null then
    raise exception
      'Les ventes et le journal de stock ne concordent pas pour le produit %.',
      v_product_id;
  end if;
end
$$;

do $$
declare
  v_product_id uuid;
begin
  with stock_baselines as (
    select
      p.id,
      coalesce(
        (
          select sm.delta
          from public.stock_movements sm
          where sm.product_id = p.id
            and sm.reason = 'adjustment'
            and sm.note ilike '%ation du produit%'
          order by sm.created_at, sm.id
          limit 1
        ),
        coalesce(p.stock_qty, 0) - coalesce(
          sum(sm.delta) filter (
            where sm.id is null
               or sm.reason <> 'adjustment'
               or sm.note is null
               or sm.note not ilike '%ation du produit%'
          ),
          0
        )
      ) as initial_qty,
      coalesce(p.stock_qty, 0) as current_qty,
      coalesce(
        sum(sm.delta) filter (
          where sm.id is null
             or sm.reason <> 'adjustment'
             or sm.note is null
             or sm.note not ilike '%ation du produit%'
        ),
        0
      ) as movement_total
    from public.products p
    left join public.stock_movements sm on sm.product_id = p.id
    group by p.id, p.stock_qty
  )
  select id
    into v_product_id
  from stock_baselines
  where initial_qty < 0
     or abs(current_qty - initial_qty - movement_total) > 0.001
  limit 1;

  if v_product_id is not null then
    raise exception
      'Le journal de stock du produit % ne permet pas de retrouver un stock initial cohérent.',
      v_product_id;
  end if;
end
$$;

with stock_baselines as (
  select
    p.id,
    coalesce(
      (
        select sm.delta
        from public.stock_movements sm
        where sm.product_id = p.id
          and sm.reason = 'adjustment'
          and sm.note ilike '%ation du produit%'
        order by sm.created_at, sm.id
        limit 1
      ),
      coalesce(p.stock_qty, 0) - coalesce(
        sum(sm.delta) filter (
          where sm.id is null
             or sm.reason <> 'adjustment'
             or sm.note is null
             or sm.note not ilike '%ation du produit%'
        ),
        0
      )
    ) as initial_qty
  from public.products p
  left join public.stock_movements sm on sm.product_id = p.id
  group by p.id, p.stock_qty
)
update public.products p
set initial_stock_qty = b.initial_qty
from stock_baselines b
where p.id = b.id
  and p.initial_stock_qty is null;

alter table public.products
  alter column initial_stock_qty set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_initial_stock_qty_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_initial_stock_qty_nonnegative
      check (initial_stock_qty >= 0);
  end if;
end
$$;

create or replace function public.capture_product_initial_stock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.initial_stock_qty := coalesce(new.stock_qty, 0);
  else
    new.initial_stock_qty := old.initial_stock_qty;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_product_initial_stock() from public, anon, authenticated;

drop trigger if exists products_capture_initial_stock on public.products;
create trigger products_capture_initial_stock
before insert or update on public.products
for each row
execute function public.capture_product_initial_stock();

commit;
