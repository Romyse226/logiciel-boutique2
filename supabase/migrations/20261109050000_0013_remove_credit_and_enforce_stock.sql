begin;

update sales
set balance_due = 0
where status = 'cancelled'
  and balance_due <> 0;

delete from sales
where status = 'partial'
   or balance_due > 0;

delete from sale_payments;

drop function if exists public.record_sale_payment(uuid, numeric, text, text, text);
drop table if exists public.sale_payments;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_no_credit'
      and conrelid = 'public.sales'::regclass
  ) then
    alter table public.sales
      add constraint sales_no_credit
      check (
        status <> 'partial'
        and balance_due = 0
        and (status <> 'paid' or amount_received >= total)
      );
  end if;
end
$$;

update products
set stock_qty = 0
where stock_qty is null
   or stock_qty < 0;

alter table public.products
  alter column stock_qty set default 0,
  alter column stock_qty set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_stock_qty_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_stock_qty_nonnegative
      check (stock_qty >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'product_sale_units_factor_positive'
      and conrelid = 'public.product_sale_units'::regclass
  ) then
    alter table public.product_sale_units
      add constraint product_sale_units_factor_positive
      check (factor_to_stock > 0);
  end if;
end
$$;

commit;
