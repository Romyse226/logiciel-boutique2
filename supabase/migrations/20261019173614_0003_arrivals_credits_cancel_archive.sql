/*
# Finalisation PWA Quincaillerie — étape 3

Étend le schéma existant pour couvrir: arrivages, crédits clients
(versements échelonnés), annulation de ventes (gérant) avec remise en stock,
archivage de produits, et traçabilité de l'auteur des mouvements/ventes.

L'application reste single-tenant (pas d'écran de connexion dans cette étape):
les politiques restent `TO anon, authenticated` avec `USING (true)` /
`WITH CHECK (true)` — données volontairement partagées par la quincaillerie.
La colonne `created_by` (texte libre) est renseignée par le frontend à partir
du profil "Gérant"/"Employé" choisi localement; elle sert uniquement d'info
d'audit affichée à l'écran, pas de contrôle d'accès.

## 1. Nouvelles colonnes
- `products.is_archived` (boolean, défaut false) — archive au lieu de supprimer.
- `stock_movements.created_by` (texte) — auteur affiché (Gérant/Employé/nom).
- `stock_movements.note` (texte) — commentaire libre (ex: "arrivage camion").
- `sales.cancelled_at` (timestamptz) — date d'annulation, null sinon.
- `sales.cancelled_by` (texte) — auteur de l'annulation.
- `sales.cancel_reason` (texte) — motif.
- `sale_items.restocked` (boolean, défaut false) — évite un double restock
  si l'annulation est rejouée.
- `sales.created_by` (texte) — vendeur.

## 2. Nouvelle table: `sale_payments`
Versements échelonnés rattachés à une vente partielle (crédit).
- `id` (uuid pk)
- `sale_id` (uuid, fk sales, cascade)
- `amount` (numeric(14,2))
- `method` (texte, défaut 'espèces')
- `note` (texte)
- `created_by` (texte)
- `created_at` (timestamptz)
Index sur sale_id. RLS activée, politiques anon/authenticated.

## 3. Nouvelles fonctions SECURITY DEFINER
- `record_arrival(p_product_id, p_quantity, p_note, p_created_by)` :
  augmente `products.stock_qty`, écrit un mouvement 'arrival', renvoie le
  nouveau stock. Accepte quantity > 0. Idempotente via rien (les arrivages
  ne sont pas dédupliqués — c'est intentionnel).
- `record_sale_payment(p_sale_id, p_amount, p_method, p_note, p_created_by)` :
  ajoute un versement à une vente, décrémente `balance_due`, incrémente
  `amount_received`, passe `status` à 'paid' quand le solde atteint 0.
  Refuse si vente annulée ou montant <= 0 ou > reste dû.
- `cancel_sale(p_sale_id, p_reason, p_cancelled_by)` :
  marque la vente 'cancelled', remet UNE SEULE FOIS les articles en stock
  (via `sale_items.restocked`), écrit un mouvement 'cancellation' par ligne.
  Refuse si déjà annulée. Renvoie le récap.

## 4. Sécurité
- RLS activée sur `sale_payments`. Politiques anon/authenticated (données
  partagées de la quincaillerie).
- `grant execute` sur les 3 nouvelles fonctions à anon + authenticated.
- Les fonctions sont SECURITY DEFINER pour pouvoir écrire dans
  products/sale_items/stock_movements quelle que soit la politique future.

## 5. Notes
- Aucune donnée existante n'est détruite. Toutes les additions sont
  additives (ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS).
- Les politiques existantes ne sont pas touchées.
- Les index sont créés avec IF NOT EXISTS.
*/

-- ============ Colonnes additives ========================================

alter table products
  add column if not exists is_archived boolean not null default false;

alter table stock_movements
  add column if not exists created_by text,
  add column if not exists note text;

alter table sales
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text,
  add column if not exists created_by text;

alter table sale_items
  add column if not exists restocked boolean not null default false;

-- La valeur 'cancelled' est désormais une 3e valeur possible pour sales.status.
-- Pas de CHECK existant à modifier (la colonne status est text libre).

-- ============ Table: sale_payments (versements échelonnés) ===============

create table if not exists sale_payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  amount      numeric(14,2) not null,
  method      text not null default 'espèces',
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists sp_sale_idx on sale_payments(sale_id);
create index if not exists sp_created_idx on sale_payments(created_at desc);

alter table sale_payments enable row level security;

drop policy if exists "sp_sel" on sale_payments;
create policy "sp_sel" on sale_payments for select to anon, authenticated using (true);
drop policy if exists "sp_ins" on sale_payments;
create policy "sp_ins" on sale_payments for insert to anon, authenticated with check (true);
drop policy if exists "sp_upd" on sale_payments;
create policy "sp_upd" on sale_payments for update to anon, authenticated using (true) with check (true);
drop policy if exists "sp_del" on sale_payments;
create policy "sp_del" on sale_payments for delete to anon, authenticated using (true);

-- Index pour filtrer les ventes annulées / partielles
create index if not exists sales_status_idx on sales(status);
create index if not exists sales_cancelled_idx on sales(cancelled_at);

-- ============ Fonction: record_arrival ==================================

create or replace function record_arrival(
  p_product_id uuid,
  p_quantity   numeric,
  p_note       text default null,
  p_created_by text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod   products%rowtype;
  v_new    numeric(14,3);
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantité d''arrivage invalide (doit être > 0)';
  end if;

  select * into v_prod from products where id = p_product_id;
  if not found then
    raise exception 'Produit introuvable';
  end if;
  if v_prod.is_archived then
    raise exception 'Produit archivé, impossible d''enregistrer un arrivage';
  end if;

  -- Si le stock n'était pas configuré (null), on part de 0.
  v_new := round(coalesce(v_prod.stock_qty, 0) + p_quantity, 3);

  update products
    set stock_qty = v_new, updated_at = now()
    where id = p_product_id;

  insert into stock_movements (product_id, sale_id, reason, delta, unit, quantity, created_by, note)
  values (p_product_id, null, 'arrival', round(p_quantity, 3), v_prod.stock_unit, round(p_quantity, 3), p_created_by, p_note);

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'new_stock_qty', v_new,
    'unit', v_prod.stock_unit
  );
end;
$$;

grant execute on function record_arrival(uuid, numeric, text, text) to anon, authenticated;

-- ============ Fonction: record_sale_payment (versement crédit) =========

create or replace function record_sale_payment(
  p_sale_id     uuid,
  p_amount      numeric,
  p_method      text default 'espèces',
  p_note        text default null,
  p_created_by  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale        sales%rowtype;
  v_new_received numeric(14,2);
  v_new_balance  numeric(14,2);
  v_new_status   text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant du versement invalide (doit être > 0)';
  end if;

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Vente introuvable';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Vente annulée, impossible d''enregistrer un versement';
  end if;
  if v_sale.status = 'paid' then
    raise exception 'Cette vente est déjà soldée';
  end if;
  if p_amount > v_sale.balance_due + 0.001 then
    raise exception 'Le versement dépasse le reste dû (%)', v_sale.balance_due;
  end if;

  v_new_received := round(v_sale.amount_received + p_amount, 2);
  v_new_balance  := round(v_sale.balance_due - p_amount, 2);
  if v_new_balance <= 0.001 then
    v_new_status  := 'paid';
    v_new_balance := 0;
  else
    v_new_status  := 'partial';
  end if;

  update sales
    set amount_received = v_new_received,
        balance_due     = v_new_balance,
        status          = v_new_status
    where id = p_sale_id;

  insert into sale_payments (sale_id, amount, method, note, created_by)
  values (p_sale_id, round(p_amount, 2), p_method, p_note, p_created_by);

  return jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'amount_received', v_new_received,
    'balance_due', v_new_balance,
    'status', v_new_status
  );
end;
$$;

grant execute on function record_sale_payment(uuid, numeric, text, text, text) to anon, authenticated;

-- ============ Fonction: cancel_sale (gérant) ===========================

create or replace function cancel_sale(
  p_sale_id       uuid,
  p_reason        text default null,
  p_cancelled_by  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale    sales%rowtype;
  v_item    sale_items%rowtype;
  v_count   int := 0;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Vente introuvable';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Vente déjà annulée';
  end if;

  -- Marquer la vente comme annulée.
  update sales
    set status        = 'cancelled',
        cancelled_at  = now(),
        cancelled_by  = p_cancelled_by,
        cancel_reason = p_reason
    where id = p_sale_id;

  -- Remettre en stock chaque ligne NON déjà restockée (une seule fois).
  for v_item in select * from sale_items where sale_id = p_sale_id and restocked = false
  loop
    v_count := v_count + 1;
    update products
      set stock_qty = round(coalesce(stock_qty, 0) + v_item.stock_decrement, 3),
          updated_at = now()
      where id = v_item.product_id;

    update sale_items set restocked = true where id = v_item.id;

    insert into stock_movements (product_id, sale_id, reason, delta, unit, quantity, created_by, note)
    values (v_item.product_id, p_sale_id, 'cancellation', round(v_item.stock_decrement, 3),
            v_item.unit, v_item.quantity, p_cancelled_by, 'Annulation vente ' || v_sale.reference);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'reference', v_sale.reference,
    'restocked_lines', v_count
  );
end;
$$;

grant execute on function cancel_sale(uuid, text, text) to anon, authenticated;

-- ============ Mise à jour de register_sale: tracer created_by ===========
-- On recrée register_sale en ajoutant p_created_by (paramètre optionnel).
-- La signature change -> on doit DROP puis CREATE (postgres impose DROP).

drop function if exists register_sale(uuid, text, jsonb, numeric, text, text, text);

create or replace function register_sale(
  p_store_id        uuid default null,
  p_idempotency_key text default null,
  p_items           jsonb default null,
  p_amount_received numeric default null,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_note            text default null,
  p_created_by      text default null
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

  v_date_part := to_char(now(), 'YYYYMMDD');
  select count(*) + 1 into v_seq from sales where reference like 'V-' || v_date_part || '-%';
  v_reference := 'V-' || v_date_part || '-' || lpad(v_seq::text, 5, '0');

  v_sale_id := gen_random_uuid();

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count_items := v_count_items + 1;
    select * into v_prod from products where id = (v_item->>'product_id')::uuid;
    if not found then
      raise exception 'Produit introuvable: %', v_item->>'product_id';
    end if;
    if v_prod.is_archived then
      raise exception 'Produit archivé, non vendable: %', v_prod.name;
    end if;

    select * into v_psu from product_sale_units
      where product_id = v_prod.id and unit = v_item->>'unit';
    if not found then
      raise exception 'Unité de vente introuvable pour %: %', v_prod.name, v_item->>'unit';
    end if;

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

  insert into sales (id, store_id, reference, idempotency_key, total, amount_received, balance_due, status, customer_name, customer_phone, note, created_by)
  values (v_sale_id, p_store_id, p_idempotency_key, v_total, v_received, v_balance, v_status, p_customer_name, p_customer_phone, p_note, p_created_by);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_prod from products where id = (v_item->>'product_id')::uuid;
    select * into v_psu  from product_sale_units where product_id = v_prod.id and unit = v_item->>'unit';

    v_line_total := round(v_psu.price * (v_item->>'quantity')::numeric, 2);
    v_stock_dec  := round(v_psu.factor_to_stock * (v_item->>'quantity')::numeric, 3);

    if v_prod.stock_qty is not null then
      if v_prod.stock_qty - v_stock_dec < 0 then
        raise exception 'Stock insuffisant pour % (reste % %)', v_prod.name, v_prod.stock_qty, v_prod.stock_unit;
      end if;
      update products set stock_qty = round(stock_qty - v_stock_dec, 3), updated_at = now()
        where id = v_prod.id;
    end if;

    insert into sale_items (sale_id, product_id, product_name, unit, quantity, unit_price, line_total, factor_to_stock, stock_decrement)
    values (v_sale_id, v_prod.id, v_prod.name, v_psu.unit, (v_item->>'quantity')::numeric, v_psu.price, v_line_total, v_psu.factor_to_stock, v_stock_dec);

    insert into stock_movements (product_id, sale_id, reason, delta, unit, quantity, created_by)
    values (v_prod.id, v_sale_id, 'sale', -v_stock_dec, v_psu.unit, (v_item->>'quantity')::numeric, p_created_by);
  end loop;

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

grant execute on function register_sale(uuid, text, jsonb, numeric, text, text, text, text) to anon, authenticated;
