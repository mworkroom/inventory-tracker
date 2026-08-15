begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

select has_table(
  'public',
  'inventory_products',
  'blank rebuild creates inventory_products'
);
select has_column(
  'public',
  'inventory_products',
  'next_sale_on',
  'inventory products store an optional next sale date'
);
select has_column(
  'public',
  'inventory_products',
  'purchase_coverage_months',
  'inventory products store optional purchase coverage months'
);
select has_column(
  'public',
  'inventory_products',
  'purchase_safety_quantity',
  'inventory products store purchase safety quantity'
);
select has_table(
  'public',
  'inventory_events',
  'blank rebuild creates inventory_events'
);
select has_table(
  'public',
  'inventory_usage_cycles',
  'blank rebuild creates inventory_usage_cycles'
);
select has_table(
  'public',
  'inventory_purchases',
  'blank rebuild creates inventory_purchases'
);
select has_table(
  'public',
  'inventory_stores',
  'blank rebuild creates inventory_stores'
);
select has_table(
  'public',
  'inventory_product_stores',
  'blank rebuild creates inventory_product_stores'
);

select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.inventory_products'::regclass
  ),
  true,
  'RLS is enabled on inventory products'
);
select is(
  has_column_privilege(
    'authenticated',
    'public.inventory_products',
    'current_quantity',
    'UPDATE'
  ),
  false,
  'authenticated clients cannot update the quantity snapshot directly'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.inventory_events',
    'INSERT'
  ),
  false,
  'authenticated clients cannot append ledger events directly'
);
select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.inventory_product_stores'::regclass
  ),
  true,
  'RLS is enabled on product shopping malls'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.inventory_product_stores',
    'INSERT'
  ),
  false,
  'authenticated clients cannot insert product shopping malls directly'
);

insert into auth.users (id, email)
values
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'inventory-member@example.com'
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'inventory-outsider@example.com'
  );

insert into public.workspace_members (workspace_id, user_id)
values (
  '00000000-0000-0000-0000-000000000002'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub =
  '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    select public.create_inventory_product_with_stores(
      p_workspace_id := '00000000-0000-0000-0000-000000000002'::uuid,
      p_name := '대패삼겹',
      p_tracking_mode := 'count',
      p_unit_label := '인분',
      p_low_stock_threshold := 2,
      p_store_ids := array(
        select id
        from public.inventory_stores
        where name in ('쿠팡', '마켓컬리')
        order by sort_order
      ),
      p_category := '식료품',
      p_next_sale_on := '2026-11-27'::date,
      p_purchase_coverage_months := 12,
      p_purchase_safety_quantity := 1
    )
  $$,
  'a workspace member can create a product through the RPC'
);
select results_eq(
  $$
    select current_quantity, stock_initialized
    from public.inventory_products
    where name = '대패삼겹'
  $$,
  $$ values (0::numeric, false) $$,
  'product creation does not invent dated stock history'
);
select results_eq(
  $$
    select next_sale_on, purchase_coverage_months, purchase_safety_quantity
    from public.inventory_products
    where name = '대패삼겹'
  $$,
  $$ values ('2026-11-27'::date, 12::integer, 1::integer) $$,
  'product creation persists the optional sale purchase plan'
);
select results_eq(
  $$
    select count(*)::bigint
    from public.inventory_events
    where product_id = (
      select id
      from public.inventory_products
      where name = '대패삼겹'
    )
  $$,
  $$ values (0::bigint) $$,
  'product creation does not append an inventory event'
);
select results_eq(
  $$
    select store.name
    from public.inventory_product_stores as product_store
    join public.inventory_stores as store
      on store.id = product_store.store_id
    join public.inventory_products as product
      on product.id = product_store.product_id
    where product.name = '대패삼겹'
    order by store.sort_order
  $$,
  $$ values ('쿠팡'::text), ('마켓컬리'::text) $$,
  'product creation stores every selected shopping mall'
);
select results_eq(
  $$
    select store.name
    from public.inventory_products as product
    join public.inventory_stores as store
      on store.id = product.preferred_store_id
    where product.name = '대패삼겹'
  $$,
  $$ values ('쿠팡'::text) $$,
  'the first shopping mall remains available to legacy readers'
);

select lives_ok(
  $$
    select public.update_inventory_product_with_stores(
      p_product_id := (
        select id
        from public.inventory_products
        where name = '대패삼겹'
      ),
      p_name := '대패삼겹',
      p_unit_label := '인분',
      p_low_stock_threshold := 2,
      p_alert_days := 30,
      p_package_size := null,
      p_capacity_unit := null,
      p_notes := null,
      p_store_ids := array[
        (
          select id
          from public.inventory_stores
          where name = '마켓컬리'
        )
      ],
      p_category := '식료품',
      p_next_sale_on := null,
      p_purchase_coverage_months := null,
      p_purchase_safety_quantity := 0
    )
  $$,
  'a workspace member can update product details and shopping malls atomically'
);
select results_eq(
  $$
    select store.name
    from public.inventory_product_stores as product_store
    join public.inventory_stores as store
      on store.id = product_store.store_id
    join public.inventory_products as product
      on product.id = product_store.product_id
    where product.name = '대패삼겹'
    order by store.sort_order
  $$,
  $$ values ('마켓컬리'::text) $$,
  'updating shopping malls replaces obsolete product links'
);

select lives_ok(
  $$
    select public.record_inventory_action(
      p_product_id := (
        select id
        from public.inventory_products
        where name = '대패삼겹'
      ),
      p_action := 'intake',
      p_amount := 1,
      p_occurred_on := '2026-07-25'::date
    )
  $$,
  'the intake RPC updates stock and ledger atomically'
);
select results_eq(
  $$
    select
      p.current_quantity,
      p.stock_initialized,
      e.quantity_delta,
      e.quantity_before,
      e.quantity_after
    from public.inventory_products p
    join public.inventory_events e on e.product_id = p.id
    where p.name = '대패삼겹'
  $$,
  $$ values (
    1::numeric,
    true,
    1::numeric,
    0::numeric,
    1::numeric
  ) $$,
  'the stock snapshot and append-only event agree'
);

select lives_ok(
  $$
    select public.correct_latest_inventory_event_amount(
      (
        select e.id
        from public.inventory_events e
        join public.inventory_products p on p.id = e.product_id
        where p.name = '대패삼겹'
      ),
      7
    )
  $$,
  'the guarded correction RPC fixes the latest mistaken intake amount'
);
select results_eq(
  $$
    select p.current_quantity, e.quantity_delta, e.quantity_after
    from public.inventory_products p
    join public.inventory_events e on e.product_id = p.id
    where p.name = '대패삼겹'
  $$,
  $$ values (7::numeric, 7::numeric, 7::numeric) $$,
  'the correction keeps product stock and ledger synchronized'
);

set local request.jwt.claim.sub =
  '22222222-2222-4222-8222-222222222222';

select results_eq(
  $$ select count(*)::bigint from public.inventory_products $$,
  $$ values (0::bigint) $$,
  'RLS hides another workspace member product from an outsider'
);
select results_eq(
  $$ select count(*)::bigint from public.inventory_product_stores $$,
  $$ values (0::bigint) $$,
  'RLS hides product shopping malls from an outsider'
);
select throws_ok(
  $$
    select public.record_inventory_action(
      p_product_id := (
        select id
        from public.inventory_products
      ),
      p_action := 'intake',
      p_amount := 1,
      p_occurred_on := '2026-07-25'::date
    )
  $$,
  '42501',
  '제품을 찾을 수 없거나 접근 권한이 없습니다.',
  'the RPC rejects an outsider even though it is security definer'
);

select * from finish();
rollback;
