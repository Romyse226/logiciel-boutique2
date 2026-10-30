/*
# Correctifs étape 4 — vente atomique + prix Gros / Détail

## 1. Correction d'un bug bloquant dans `register_sale()`
La version créée en étape 3 (migration 0003) insérait la vente avec
11 expressions pour 12 colonnes : la valeur `v_reference` avait été oubliée
dans la liste `values`, ce qui provoquait à chaque vente l'erreur Postgres

    INSERT has more target columns than expressions

La fonction est recréée ici avec la liste de valeurs complète
(`v_reference` inséré à sa place, entre `store_id` et `idempotency_key`).

## 2. Modèle de prix simplifié : "Prix Gros" / "Prix Détail"
L'application ne gère plus qu'un seul couple de prix par produit, porté par
deux unités de vente réservées :
  - `Gros`   → prix de gros
  - `Détail` → prix de détail (unité par défaut)

La migration normalise les données existantes :
  - ajout de l'unité `Détail` (elle reprend le prix de l'ancienne unité par
    défaut quand il existe, sinon 0 = "à configurer") ;
  - ajout de l'unité `Gros` (prix 0 = "à configurer") ;
  - suppression des anciennes unités (`sac`, `pièce`, `barre`, `tonne`, …)
    devenues inutiles ;
  - `Détail` devient l'unique unité par défaut.

Les conversions (`factor_to_stock`) valent 1 : une unité vendue =
une unité de stock.

## 3. Notes
- Aucune vente, aucun article et aucun mouvement de stock existant n'est
  modifié ou supprimé.
- La signature de `register_sale` est inchangée (8 paramètres).
*/

-- ============ 1. register_sale() corrigée ===============================

drop function if exists register_sale(uuid, text, jsonb, numeric, text, text, text, text);

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
  -- Idempotence : une même clé rejouée renvoie la vente déjà créée.
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

  -- Référence lisible : V-YYYYMMDD-NNNNN
  v_date_part := to_char(now(), 'YYYYMMDD');
  select count(*) + 1 into v_seq from sales where reference like 'V-' || v_date_part || '-%';
  v_reference := 'V-' || v_date_part || '-' || lpad(v_seq::text, 5, '0');

  v_sale_id := gen_random_uuid();

  -- Première passe : on valide chaque ligne et on cumule le total.
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

    -- Le serveur fait foi pour le prix : tout écart client est refusé.
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

  -- En-tête de vente : 12 colonnes / 12 valeurs.
  insert into sales (
    id, store_id, reference, idempotency_key, total, amount_received,
    balance_due, status, customer_name, customer_phone, note, created_by
  )
  values (
    v_sale_id, p_store_id, v_reference, p_idempotency_key, v_total, v_received,
    v_balance, v_status, p_customer_name, p_customer_phone, p_note, p_created_by
  );

  -- Deuxième passe : lignes, décrément du stock, mouvements.
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

-- ============ 2. Normalisation des prix Gros / Détail ===================

-- 2.1 Unité "Détail" pour chaque produit (reprend l'ancien prix par défaut).
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id,
       'Détail',
       coalesce((
         select psu.price
         from product_sale_units psu
         where psu.product_id = p.id and psu.price > 0
         order by psu.is_default desc, psu.created_at asc
         limit 1
       ), 0),
       1, true, false
from products p
where not exists (
  select 1 from product_sale_units x where x.product_id = p.id and x.unit = 'Détail'
);

-- 2.2 Unité "Gros" pour chaque produit (0 = "à configurer").
insert into product_sale_units (product_id, unit, price, factor_to_stock, is_default, allow_decimal)
select p.id, 'Gros', 0, 1, false, false
from products p
where not exists (
  select 1 from product_sale_units x where x.product_id = p.id and x.unit = 'Gros'
);

-- 2.3 Suppression des anciennes unités (sac, pièce, barre, tonne, …).
delete from product_sale_units where unit not in ('Gros', 'Détail');

-- 2.4 "Détail" est l'unique unité par défaut.
update product_sale_units set is_default = (unit = 'Détail');
