/*
# Initial schema — Quincaillerie PWA (Étape 1)

Single-tenant demo hardware-store schema for a Côte d'Ivoire "quincaillerie".
No auth in this step: the frontend uses the anon key, so every policy is
scoped to `anon, authenticated` (data is intentionally shared/public for the
demo store). The schema is designed to extend later to multi-store + multi-user
by adding `store_id` / `user_id` columns and tightening policies, without
rewriting the core sales flow.

## 1. New tables

- `stores`             — one demo quincaillerie (name, phone, address). Foundation for multi-store later.
- `product_categories` — reference categories (Gros œuvre, Plomberie, Électricité, …) keyed by a stable slug.
- `products`           — each distinct reference (size/diameter/model = separate row). Belongs to a category. Has a stock unit + current stock qty (nullable = "À configurer").
- `product_sale_units` — the sellable units for a product (e.g. sac, tonne) with their own price and a conversion factor back to the stock unit.
- `sales`              — one sale = header (reference, totals, amount received, balance, status). Atomic via a SECURITY DEFINER function.
- `sale_items`         — lines of a sale (product, unit, qty, unit price, line total, conversion snapshot).
- `payments`           — reserved for future split (cash vs Mobile Money). Right now one row mirrors the sale-level payment.
- `stock_movements`    — append-only ledger: every sale writes one movement per line. Reason = 'sale'. Future: 'arrival', 'adjustment'.

## 2. Idempotency / atomicity

- `register_sale()` is a SECURITY DEFINER PL/pgSQL function. It is the ONLY
  sanctioned way to create a sale: it verifies every line's price/stock/unit
  conversion inside the DB, recomputes the total, decrements stock atomically,
  writes `sale_items` + `stock_movements`, and refuses negative stock.
  A client-supplied `idempotency_key` makes double-click / network-retry safe:
  a second call with the same key returns the original sale instead of duplicating.
- Prices are NUMERIC(14,2) (FCFA, 0 decimals). Quantities NUMERIC(14,3) to
  allow fractional sell units (e.g. metres, tonnes). Conversion factors
  NUMERIC(18,6).

## 3. Security

- RLS ENABLED on every table.
- Because this is a no-auth demo, every policy is `TO anon, authenticated`
  with `USING (true)` / `WITH CHECK (true)` — the data is intentionally shared.
  When auth/users arrive in a later step, these will be tightened to
  store-scoped ownership checks.
- `register_sale()` is SECURITY DEFINER so it can write sale_items /
  stock_movements / decrement products even if those tables later get
  tighter policies; callable by anon + authenticated.

## 4. Notes

- `sales.reference` is a human-readable receipt number (`V-YYYYMMDD-NNNNN`)
  generated server-side and UNIQUE.
- `sales.idempotency_key` is UNIQUE so retries collapse.
- Indexes on common lookup paths (category, sale reference, stock movement product).
- Seed categories + ~30 demo products + their sale units happen in a separate
  idempotent migration so this one stays structural.
*/

-- Extensions -------------------------------------------------------------
create extension if not exists "pgcrypto";

-- stores -----------------------------------------------------------------
create table if not exists stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Quincaillerie Démo',
  phone       text,
  address     text,
  is_demo     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- product_categories -----------------------------------------------------
create table if not exists product_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  color       text not null default 'blue',
  icon        text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- products ---------------------------------------------------------------
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid references stores(id) on delete set null,
  category_id   uuid references product_categories(id) on delete set null,
  name          text not null,
  description   text,
  image_url     text,
  stock_unit    text not null default 'pièce',
  stock_qty     numeric(14,3),            -- null = "À configurer"
  low_stock_threshold numeric(14,3) default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists products_category_idx on products(category_id);
create index if not exists products_name_idx on products(name);

-- product_sale_units -----------------------------------------------------
create table if not exists product_sale_units (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  unit            text not null,                    -- 'sac', 'tonne', 'pièce', 'm', ...
  price           numeric(14,2) not null,           -- FCFA
  factor_to_stock numeric(18,6) not null default 1, -- how many stock_units one sale unit equals
  is_default      boolean not null default false,
  allow_decimal   boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (product_id, unit)
);
create index if not exists psu_product_idx on product_sale_units(product_id);

-- sales ------------------------------------------------------------------
create table if not exists sales (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid references stores(id) on delete set null,
  reference       text not null unique,
  idempotency_key text unique,
  total           numeric(14,2) not null default 0,
  amount_received numeric(14,2) not null default 0,
  balance_due     numeric(14,2) not null default 0,
  status          text not null default 'paid',   -- 'paid' | 'partial'
  customer_name   text,
  customer_phone  text,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists sales_created_idx on sales(created_at desc);
create index if not exists sales_reference_idx on sales(reference);

-- sale_items -------------------------------------------------------------
create table if not exists sale_items (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references sales(id) on delete cascade,
  product_id      uuid not null references products(id) on delete restrict,
  product_name    text not null,
  unit            text not null,
  quantity        numeric(14,3) not null,
  unit_price      numeric(14,2) not null,
  line_total      numeric(14,2) not null,
  factor_to_stock numeric(18,6) not null default 1,
  stock_decrement numeric(14,3) not null,
  created_at      timestamptz not null default now()
);
create index if not exists si_sale_idx on sale_items(sale_id);

-- payments (reserved for future cash/momo split) -------------------------
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references sales(id) on delete cascade,
  method          text not null default 'espèces', -- 'espèces' | 'mobile_money' (future)
  amount          numeric(14,2) not null,
  created_at      timestamptz not null default now()
);
create index if not exists pay_sale_idx on payments(sale_id);

-- stock_movements (append-only ledger) -----------------------------------
create table if not exists stock_movements (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete restrict,
  sale_id         uuid references sales(id) on delete set null,
  reason          text not null,            -- 'sale' | 'arrival' | 'adjustment' (future)
  delta           numeric(14,3) not null,   -- negative for sales
  unit            text not null,
  quantity        numeric(14,3) not null,
  created_at      timestamptz not null default now()
);
create index if not exists sm_product_idx on stock_movements(product_id);
create index if not exists sm_sale_idx on stock_movements(sale_id);

-- Default demo store -----------------------------------------------------
insert into stores (id, name, phone, address, is_demo)
select '00000000-0000-0000-0000-000000000001', 'Quincaillerie Démo', '+225 07 00 00 00 00', 'Abidjan, Côte d''Ivoire', true
where not exists (select 1 from stores where id = '00000000-0000-0000-0000-000000000001');

-- ============ RLS =======================================================
alter table stores             enable row level security;
alter table product_categories enable row level security;
alter table products           enable row level security;
alter table product_sale_units enable row level security;
alter table sales              enable row level security;
alter table sale_items         enable row level security;
alter table payments           enable row level security;
alter table stock_movements    enable row level security;

-- Helper: drop+recreate a full CRUD policy set for a single-tenant table.
-- (No-auth demo: data is intentionally shared, so USING/WITH CHECK are true.)

-- stores
drop policy if exists "st_sel" on stores;
create policy "st_sel" on stores for select to anon, authenticated using (true);
drop policy if exists "st_ins" on stores;
create policy "st_ins" on stores for insert to anon, authenticated with check (true);
drop policy if exists "st_upd" on stores;
create policy "st_upd" on stores for update to anon, authenticated using (true) with check (true);
drop policy if exists "st_del" on stores;
create policy "st_del" on stores for delete to anon, authenticated using (true);

-- product_categories
drop policy if exists "pc_sel" on product_categories;
create policy "pc_sel" on product_categories for select to anon, authenticated using (true);
drop policy if exists "pc_ins" on product_categories;
create policy "pc_ins" on product_categories for insert to anon, authenticated with check (true);
drop policy if exists "pc_upd" on product_categories;
create policy "pc_upd" on product_categories for update to anon, authenticated using (true) with check (true);
drop policy if exists "pc_del" on product_categories;
create policy "pc_del" on product_categories for delete to anon, authenticated using (true);

-- products
drop policy if exists "p_sel" on products;
create policy "p_sel" on products for select to anon, authenticated using (true);
drop policy if exists "p_ins" on products;
create policy "p_ins" on products for insert to anon, authenticated with check (true);
drop policy if exists "p_upd" on products;
create policy "p_upd" on products for update to anon, authenticated using (true) with check (true);
drop policy if exists "p_del" on products;
create policy "p_del" on products for delete to anon, authenticated using (true);

-- product_sale_units
drop policy if exists "psu_sel" on product_sale_units;
create policy "psu_sel" on product_sale_units for select to anon, authenticated using (true);
drop policy if exists "psu_ins" on product_sale_units;
create policy "psu_ins" on product_sale_units for insert to anon, authenticated with check (true);
drop policy if exists "psu_upd" on product_sale_units;
create policy "psu_upd" on product_sale_units for update to anon, authenticated using (true) with check (true);
drop policy if exists "psu_del" on product_sale_units;
create policy "psu_del" on product_sale_units for delete to anon, authenticated using (true);

-- sales
drop policy if exists "s_sel" on sales;
create policy "s_sel" on sales for select to anon, authenticated using (true);
drop policy if exists "s_ins" on sales;
create policy "s_ins" on sales for insert to anon, authenticated with check (true);
drop policy if exists "s_upd" on sales;
create policy "s_upd" on sales for update to anon, authenticated using (true) with check (true);
drop policy if exists "s_del" on sales;
create policy "s_del" on sales for delete to anon, authenticated using (true);

-- sale_items
drop policy if exists "si_sel" on sale_items;
create policy "si_sel" on sale_items for select to anon, authenticated using (true);
drop policy if exists "si_ins" on sale_items;
create policy "si_ins" on sale_items for insert to anon, authenticated with check (true);
drop policy if exists "si_upd" on sale_items;
create policy "si_upd" on sale_items for update to anon, authenticated using (true) with check (true);
drop policy if exists "si_del" on sale_items;
create policy "si_del" on sale_items for delete to anon, authenticated using (true);

-- payments
drop policy if exists "pay_sel" on payments;
create policy "pay_sel" on payments for select to anon, authenticated using (true);
drop policy if exists "pay_ins" on payments;
create policy "pay_ins" on payments for insert to anon, authenticated with check (true);
drop policy if exists "pay_upd" on payments;
create policy "pay_upd" on payments for update to anon, authenticated using (true) with check (true);
drop policy if exists "pay_del" on payments;
create policy "pay_del" on payments for delete to anon, authenticated using (true);

-- stock_movements
drop policy if exists "sm_sel" on stock_movements;
create policy "sm_sel" on stock_movements for select to anon, authenticated using (true);
drop policy if exists "sm_ins" on stock_movements;
create policy "sm_ins" on stock_movements for insert to anon, authenticated with check (true);
drop policy if exists "sm_upd" on stock_movements;
create policy "sm_upd" on stock_movements for update to anon, authenticated using (true) with check (true);
drop policy if exists "sm_del" on stock_movements;
create policy "sm_del" on stock_movements for delete to anon, authenticated using (true);

-- ============ register_sale() ==========================================
-- Atomic sale creation. Verifies prices/stock/conversions server-side.
-- Idempotent via p_idempotency_key.
-- SECURITY DEFINER so it can write to all tables even after future policy tightening.
create or replace function register_sale(
  p_store_id        uuid default null,
  p_idempotency_key text default null,
  p_items           jsonb default null,   -- [{product_id, unit, quantity, unit_price}]
  p_amount_received numeric default null,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_note            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id        uuid;
  v_reference      text;
  v_total          numeric(14,2) := 0;
  v_received       numeric(14,2);
  v_balance        numeric(14,2);
  v_status         text;
  v_item           jsonb;
  v_prod           products%rowtype;
  v_psu            product_sale_units%rowtype;
  v_line_total     numeric(14,2);
  v_stock_dec      numeric(14,3);
  v_existing       sales%rowtype;
  v_date_part      text;
  v_seq            int;
  v_count_items    int := 0;
begin
  -- Idempotency: return the existing sale if the same key is replayed.
  if p_idempotency_key is not null then
    select * into v_existing from sales where idempotency_key = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object(
        'ok', true,
        'sale_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total,
        'amount_received', v_existing.amount_received,
        'balance_due', v_existing.balance_due,
        'status', v_existing.status,
        'replayed', true
      );
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Aucun article dans la vente';
  end if;

  -- Compute a human-readable reference: V-YYYYMMDD-NNNNN
  v_date_part := to_char(now(), 'YYYYMMDD');
  select count(*) + 1 into v_seq from sales where reference like 'V-' || v_date_part || '-%';
  v_reference := 'V-' || v_date_part || '-' || lpad(v_seq::text, 5, '0');

  v_sale_id := gen_random_uuid();

  -- First pass: validate every line, accumulate total.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count_items := v_count_items + 1;
    select * into v_prod from products where id = (v_item->>'product_id')::uuid;
    if not found then
      raise exception 'Produit introuvable: %', v_item->>'product_id';
    end if;

    select * into v_psu from product_sale_units
      where product_id = v_prod.id and unit = v_item->>'unit';
    if not found then
      raise exception 'Unité de vente introuvable pour %: %', v_prod.name, v_item->>'unit';
    end if;

    -- Server is the source of truth for price: ignore any client-supplied price mismatch.
    if (v_item->>'unit_price')::numeric <> v_psu.price then
      raise exception 'Prix incohérent pour % (attendu %)', v_prod.name, v_psu.price;
    end if;

    if (v_item->>'quantity')::numeric <= 0 then
      raise exception 'Quantité invalide pour %', v_prod.name;
    end if;

    if not v_psu.allow_decimal and floor((v_item->>'quantity')::numeric) <> (v_item->>'quantity')::numeric then
      raise exception 'Quantité décimale non autorisée pour %', v_prod.name;
    end if;

    v_line_total := round(v_psu.price * (v_item->>'quantity')::numeric, 2);
    v_total := v_total + v_line_total;
  end loop;

  if v_count_items = 0 then
    raise exception 'Aucun article dans la vente';
  end if;

  v_received := coalesce(p_amount_received, v_total);
  if v_received < 0 then
    raise exception 'Montant reçu invalide';
  end if;
  v_balance := v_total - v_received;
  if v_balance > 0 then
    v_status := 'partial';
  else
    v_status := 'paid';
    v_balance := 0;
    v_received := v_total;
  end if;

  -- Insert the sale header.
  insert into sales (id, store_id, reference, idempotency_key, total, amount_received, balance_due, status, customer_name, customer_phone, note)
  values (v_sale_id, p_store_id, v_reference, p_idempotency_key, v_total, v_received, v_balance, v_status, p_customer_name, p_customer_phone, p_note);

  -- Second pass: write items, decrement stock, record movements. Abort if stock insufficient.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_prod from products where id = (v_item->>'product_id')::uuid;
    select * into v_psu  from product_sale_units where product_id = v_prod.id and unit = v_item->>'unit';

    v_line_total := round(v_psu.price * (v_item->>'quantity')::numeric, 2);
    v_stock_dec  := round(v_psu.factor_to_stock * (v_item->>'quantity')::numeric, 3);

    -- Stock check: only block if stock is configured (not null). If null => "À configurer", allow but flag.
    if v_prod.stock_qty is not null then
      if v_prod.stock_qty - v_stock_dec < 0 then
        raise exception 'Stock insuffisant pour % (reste % %)', v_prod.name, v_prod.stock_qty, v_prod.stock_unit;
      end if;
      update products set stock_qty = round(stock_qty - v_stock_dec, 3), updated_at = now()
        where id = v_prod.id;
    end if;

    insert into sale_items (sale_id, product_id, product_name, unit, quantity, unit_price, line_total, factor_to_stock, stock_decrement)
    values (v_sale_id, v_prod.id, v_prod.name, v_psu.unit, (v_item->>'quantity')::numeric, v_psu.price, v_line_total, v_psu.factor_to_stock, v_stock_dec);

    insert into stock_movements (product_id, sale_id, reason, delta, unit, quantity)
    values (v_prod.id, v_sale_id, 'sale', -v_stock_dec, v_psu.unit, (v_item->>'quantity')::numeric);
  end loop;

  -- Mirror payment row (single method for now; reserved for future split).
  insert into payments (sale_id, method, amount) values (v_sale_id, 'espèces', v_received);

  return jsonb_build_object(
    'ok', true,
    'sale_id', v_sale_id,
    'reference', v_reference,
    'total', v_total,
    'amount_received', v_received,
    'balance_due', v_balance,
    'status', v_status,
    'replayed', false
  );
end;
$$;

-- Allow anon + authenticated to call register_sale()
grant execute on function register_sale(uuid, text, jsonb, numeric, text, text, text) to anon, authenticated;

-- ============ updated_at trigger =======================================
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_updated_at on products;
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();

drop trigger if exists stores_updated_at on stores;
create trigger stores_updated_at before update on stores
  for each row execute function set_updated_at();
