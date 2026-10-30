/*
# Étape 7 — Contrôle d'accès côté serveur sur les ventes  (fichier ASCII)

Objectif : un employé dont l'accès a été retiré par le boss (statut
" suspended ") ne peut plus enregistrer de vente, meme s'il contourne
l'interface de l'application.

## 1. register_sale(...) verifie l'acteur
Deux parametres optionnels sont ajoutes en fin de signature :
  - p_actor_id, p_actor_token.
Lorsqu'ils sont fournis, la vente n'est acceptee que si l'acteur existe et
que son statut est " active " (controle employee_name, qui exige
status = 'active'). Sinon la fonction renvoie une erreur explicite.

## 2. Retrocompatibilite
Un appel sans identifiants d'acteur (rejeu hors-ligne d'un ancien appareil,
tests, base pas encore migree) conserve l'ancien comportement : aucun
changement pour les ventes legitimes.

## 3. Notes
Aucune donnee n'est supprimee ni modifiee. Les parametres par defaut
preservent la signature precedente (8 parametres) : l'ancienne fonction est
simplement remplacee. Les textes accentues sont produits via U&'...' pour
garantir un fichier ASCII pur (pas de mojibake).
*/

-- ============ 1. register_sale() avec controle d'acces =================

drop function if exists register_sale(uuid, text, jsonb, numeric, text, text, text, text);

create or replace function register_sale(
  p_store_id        uuid default null,
  p_idempotency_key text default null,
  p_items           jsonb default null,
  p_amount_received numeric default null,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_note            text default null,
  p_created_by      text default null,
  p_actor_id        uuid default null,
  p_actor_token     text default null
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
  v_actor          text;
begin
  -- Controle d'acces : si l'appareil presente ses identifiants, l'acteur doit
  -- etre un acces actif (le boss ou un employe non revoque).
  if p_actor_id is not null or p_actor_token is not null then
    v_actor := employee_name(p_actor_id, p_actor_token);
    if v_actor is null then
      return jsonb_build_object(
        'ok', false,
        'sale_id', null,
        'reference', null,
        'total', 0,
        'amount_received', 0,
        'balance_due', 0,
        'status', 'paid',
        'error', U&'Votre acc\00e8s a \00e9t\00e9 retir\00e9. Contactez le boss pour qu''il vous r\00e9active.'
      );
    end if;
  end if;

  -- Idempotence : une meme cle rejouee renvoie la vente deja creee.
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

  -- Reference lisible : V-YYYYMMDD-NNNNN
  v_date_part := to_char(now(), 'YYYYMMDD');
  select count(*) + 1 into v_seq from sales where reference like 'V-' || v_date_part || '-%';
  v_reference := 'V-' || v_date_part || '-' || lpad(v_seq::text, 5, '0');

  v_sale_id := gen_random_uuid();

  -- Premiere passe : on valide chaque ligne et on cumule le total.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count_items := v_count_items + 1;
    select * into v_prod from products where id = (v_item->>'product_id')::uuid;
    if not found then
      raise exception 'Produit introuvable: %', v_item->>'product_id';
    end if;
    if v_prod.is_archived then
      raise exception U&'Produit archiv\00e9, non vendable: %', v_prod.name;
    end if;

    select * into v_psu from product_sale_units
      where product_id = v_prod.id and unit = v_item->>'unit';
    if not found then
      raise exception U&'Unit\00e9 de vente introuvable pour %: %', v_prod.name, v_item->>'unit';
    end if;

    -- Le serveur fait foi pour le prix : tout ecart client est refuse.
    if (v_item->>'unit_price')::numeric <> v_psu.price then
      raise exception U&'Prix incoh\00e9rent pour % (attendu %)', v_prod.name, v_psu.price;
    end if;

    if (v_item->>'quantity')::numeric <= 0 then
      raise exception U&'Quantit\00e9 invalide pour %', v_prod.name;
    end if;

    if not v_psu.allow_decimal and floor((v_item->>'quantity')::numeric) <> (v_item->>'quantity')::numeric then
      raise exception U&'Quantit\00e9 d\00e9cimale non autoris\00e9e pour %', v_prod.name;
    end if;

    v_line_total := round(v_psu.price * (v_item->>'quantity')::numeric, 2);
    v_total := v_total + v_line_total;
  end loop;

  if v_count_items = 0 then
    raise exception 'Aucun article dans la vente';
  end if;

  v_received := coalesce(p_amount_received, v_total);
  if v_received < 0 then
    raise exception 'Montant recu invalide';
  end if;
  v_balance := v_total - v_received;
  if v_balance > 0 then
    v_status := 'partial';
  else
    v_status := 'paid';
    v_balance := 0;
    v_received := v_total;
  end if;

  -- En-tete de vente : 12 colonnes / 12 valeurs.
  insert into sales (
    id, store_id, reference, idempotency_key, total, amount_received,
    balance_due, status, customer_name, customer_phone, note, created_by
  )
  values (
    v_sale_id, p_store_id, v_reference, p_idempotency_key, v_total, v_received,
    v_balance, v_status, p_customer_name, p_customer_phone, p_note, p_created_by
  );

  -- Deuxieme passe : lignes, decrement du stock, mouvements.
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

  insert into payments (sale_id, method, amount) values (v_sale_id, U&'esp\00e8ces', v_received);

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

grant execute on function register_sale(uuid, text, jsonb, numeric, text, text, text, text, uuid, text)
  to anon, authenticated;
