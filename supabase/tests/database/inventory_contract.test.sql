begin;

create extension if not exists pgtap with schema extensions;
select plan(69);

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
select has_column(
  'public',
  'inventory_products',
  'active_months',
  'inventory products store optional active usage months'
);
select has_column(
  'public',
  'inventory_products',
  'usage_tracking',
  'inventory products store the new default usage recording workflow'
);
select has_column(
  'public',
  'inventory_products',
  'usage_tracking_changed_on',
  'inventory products can preserve the future-effective workflow change date'
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
select has_table(
  'public',
  'inventory_consumption_baselines',
  'blank rebuild creates recalled consumption baselines'
);
select has_table(
  'public',
  'inventory_product_sale_schedules',
  'blank rebuild creates recurring product sale schedules'
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
select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.inventory_consumption_baselines'::regclass
  ),
  true,
  'RLS is enabled on recalled consumption baselines'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.inventory_consumption_baselines',
    'SELECT'
  ),
  true,
  'authenticated clients can read an allowed recalled consumption baseline'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.inventory_consumption_baselines',
    'INSERT'
  ),
  false,
  'stage 1 clients cannot write recalled consumption baselines directly'
);
select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.inventory_product_sale_schedules'::regclass
  ),
  true,
  'RLS is enabled on recurring product sale schedules'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.inventory_product_sale_schedules',
    'SELECT'
  ),
  true,
  'authenticated clients can read allowed recurring product sale schedules'
);
select is(
  has_table_privilege(
    'authenticated',
    'public.inventory_product_sale_schedules',
    'INSERT'
  ),
  false,
  'stage 1 clients cannot write recurring product sale schedules directly'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.update_inventory_event_amount(uuid,numeric)',
    'EXECUTE'
  ),
  true,
  'authenticated members can execute the replaying event update RPC'
);
select is(
  has_function_privilege(
    'anon',
    'public.update_inventory_event_amount(uuid,numeric)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot execute the replaying event update RPC'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.delete_inventory_event(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated members can execute the replaying event delete RPC'
);
select is(
  has_function_privilege(
    'anon',
    'public.delete_inventory_event(uuid)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot execute the replaying event delete RPC'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.create_inventory_product_with_schedules(uuid,text,text,text,numeric,integer,numeric,text,text,uuid[],text,integer,jsonb)',
    'EXECUTE'
  ),
  true,
  'authenticated members can execute observation-model product creation'
);
select is(
  has_function_privilege(
    'anon',
    'public.create_inventory_product_with_schedules(uuid,text,text,text,numeric,integer,numeric,text,text,uuid[],text,integer,jsonb)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot execute observation-model product creation'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.update_inventory_product_with_schedules(uuid,text,text,text,numeric,integer,numeric,text,text,uuid[],text,integer,jsonb)',
    'EXECUTE'
  ),
  true,
  'authenticated members can execute observation-model product updates'
);
select is(
  has_function_privilege(
    'anon',
    'public.update_inventory_product_with_schedules(uuid,text,text,text,numeric,integer,numeric,text,text,uuid[],text,integer,jsonb)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot execute observation-model product updates'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.upsert_inventory_consumption_baseline(uuid,date,date,numeric,integer,text)',
    'EXECUTE'
  ),
  true,
  'authenticated members can save a recalled consumption baseline'
);
select is(
  has_function_privilege(
    'anon',
    'public.upsert_inventory_consumption_baseline(uuid,date,date,numeric,integer,text)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot save a recalled consumption baseline'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.delete_inventory_consumption_baseline(uuid)',
    'EXECUTE'
  ),
  true,
  'authenticated members can delete a recalled consumption baseline'
);
select is(
  has_function_privilege(
    'anon',
    'public.delete_inventory_consumption_baseline(uuid)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot delete a recalled consumption baseline'
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
      p_alert_days := 30,
      p_package_size := null,
      p_capacity_unit := null,
      p_current_consumer_count := 1,
      p_notes := null,
      p_store_ids := array(
        select id
        from public.inventory_stores
        where name in ('쿠팡', '마켓컬리')
        order by sort_order
      ),
      p_category := '식료품',
      p_next_sale_on := '2026-11-27'::date,
      p_purchase_coverage_months := 12,
      p_purchase_safety_quantity := 1,
      p_active_months := array[6, 7, 8]
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
    select usage_tracking
    from public.inventory_products
    where name = '대패삼겹'
  $$,
  $$ values ('decrement'::text) $$,
  'the legacy count workflow maps to decrement usage tracking'
);
select results_eq(
  $$
    select
      next_sale_on,
      purchase_coverage_months,
      purchase_safety_quantity,
      active_months
    from public.inventory_products
    where name = '대패삼겹'
  $$,
  $$ values (
    '2026-11-27'::date,
    12::integer,
    1::integer,
    array[6, 7, 8]::integer[]
  ) $$,
  'product creation persists the optional sale plan and active months'
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
      p_purchase_safety_quantity := 0,
      p_active_months := null
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
select results_eq(
  $$
    select active_months is null
    from public.inventory_products
    where name = '대패삼겹'
  $$,
  $$ values (true) $$,
  'null active months restore year-round usage'
);

select lives_ok(
  $$
    select public.create_inventory_product_with_schedules(
      p_workspace_id := '00000000-0000-0000-0000-000000000002'::uuid,
      p_name := '관찰 모델 토너',
      p_usage_tracking := 'decrement',
      p_unit_label := '병',
      p_low_stock_threshold := 1,
      p_alert_days := 30,
      p_package_size := 300,
      p_capacity_unit := 'ml',
      p_notes := null,
      p_store_ids := array[
        (
          select id from public.inventory_stores
          where name = '올리브영'
        )
      ],
      p_category := '화장품',
      p_purchase_safety_quantity := 1,
      p_sale_schedules := jsonb_build_array(
        jsonb_build_object(
          'store_id', (
            select id from public.inventory_stores
            where name = '올리브영'
          ),
          'name', '올영세일',
          'sale_month', 9,
          'sale_day', 1
        )
      )
    )
  $$,
  'the observation-model RPC creates a product and recurring sale atomically'
);
select results_eq(
  $$
    select
      usage_tracking,
      tracking_mode,
      active_months is null,
      next_sale_on is null,
      purchase_coverage_months is null
    from public.inventory_products
    where name = '관찰 모델 토너'
  $$,
  $$ values ('decrement'::text, 'count'::text, true, true, true) $$,
  'new products use the observation workflow and leave manual seasonal fields empty'
);
select results_eq(
  $$
    select schedule.name, schedule.sale_month, schedule.sale_day, store.name
    from public.inventory_product_sale_schedules as schedule
    join public.inventory_stores as store on store.id = schedule.store_id
    join public.inventory_products as product on product.id = schedule.product_id
    where product.name = '관찰 모델 토너'
  $$,
  $$ values ('올영세일'::text, 9::integer, 1::integer, '올리브영'::text) $$,
  'recurring sale schedules retain event name, date and linked store'
);
select lives_ok(
  $$
    select public.upsert_inventory_consumption_baseline(
      p_product_id := (
        select id from public.inventory_products
        where name = '관찰 모델 토너'
      ),
      p_started_on := '2026-05-01'::date,
      p_ended_on := '2026-07-31'::date,
      p_consumed_quantity := 1,
      p_consumer_count := 1,
      p_note := '정확한 사건이 아닌 회상 기준'
    )
  $$,
  'a member can save one recalled baseline through the guarded RPC'
);
select results_eq(
  $$
    select
      baseline.usage_tracking,
      baseline.consumed_quantity,
      baseline.quantity_unit,
      baseline.package_size,
      baseline.capacity_unit
    from public.inventory_consumption_baselines as baseline
    join public.inventory_products as product on product.id = baseline.product_id
    where product.name = '관찰 모델 토너'
  $$,
  $$ values ('decrement'::text, 1::numeric, '병'::text, 300::numeric, 'ml'::text) $$,
  'the recalled baseline snapshots the current usage interpretation and units'
);
select lives_ok(
  $$
    select public.update_inventory_product_with_schedules(
      p_product_id := (
        select id from public.inventory_products
        where name = '관찰 모델 토너'
      ),
      p_name := '관찰 모델 토너',
      p_usage_tracking := 'cycle',
      p_unit_label := '병',
      p_low_stock_threshold := 1,
      p_alert_days := 30,
      p_package_size := 300,
      p_capacity_unit := 'ml',
      p_notes := null,
      p_store_ids := array[
        (
          select id from public.inventory_stores
          where name = '올리브영'
        )
      ],
      p_category := '화장품',
      p_purchase_safety_quantity := 2,
      p_sale_schedules := jsonb_build_array(
        jsonb_build_object(
          'store_id', (
            select id from public.inventory_stores
            where name = '올리브영'
          ),
          'name', '겨울 올영세일',
          'sale_month', 12,
          'sale_day', 1
        )
      )
    )
  $$,
  'a product without an active cycle can change its future usage workflow'
);
select results_eq(
  $$
    select
      product.usage_tracking,
      product.tracking_mode,
      product.usage_tracking_changed_on is not null,
      schedule.name,
      schedule.sale_month,
      product.purchase_safety_quantity
    from public.inventory_products as product
    join public.inventory_product_sale_schedules as schedule
      on schedule.product_id = product.id
    where product.name = '관찰 모델 토너'
  $$,
  $$ values (
    'cycle'::text,
    'cycle'::text,
    true,
    '겨울 올영세일'::text,
    12::integer,
    2::integer
  ) $$,
  'workflow changes are dated and recurring schedules are atomically replaced'
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

select lives_ok(
  $$
    select public.create_inventory_product_with_stores(
      p_workspace_id := '00000000-0000-0000-0000-000000000002'::uuid,
      p_name := '히알루론산 크림 테스트',
      p_tracking_mode := 'cycle',
      p_unit_label := '통',
      p_low_stock_threshold := 1,
      p_package_size := 50,
      p_capacity_unit := 'ml',
      p_store_ids := '{}'::uuid[],
      p_category := '화장품'
    )
  $$,
  'a cycle product can be created for historical event correction tests'
);
select results_eq(
  $$
    select usage_tracking
    from public.inventory_products
    where name = '히알루론산 크림 테스트'
  $$,
  $$ values ('cycle'::text) $$,
  'the legacy cycle workflow remains synchronized with cycle usage tracking'
);
select lives_ok(
  $$
    select public.record_inventory_action(
      p_product_id := (
        select id from public.inventory_products
        where name = '히알루론산 크림 테스트'
      ),
      p_action := 'intake',
      p_amount := 2,
      p_occurred_on := '2026-04-06'::date
    )
  $$,
  'the first cycle-product intake is recorded'
);
select lives_ok(
  $$
    select public.record_inventory_action(
      p_product_id := (
        select id from public.inventory_products
        where name = '히알루론산 크림 테스트'
      ),
      p_action := 'intake',
      p_amount := 1,
      p_occurred_on := '2026-04-06'::date
    )
  $$,
  'the compensating cycle-product intake is recorded'
);
select lives_ok(
  $$
    select public.delete_inventory_event(
      (
        select event.id
        from public.inventory_events as event
        join public.inventory_products as product
          on product.id = event.product_id
        where product.name = '히알루론산 크림 테스트'
        order by event.created_at desc, event.id desc
        limit 1
      )
    )
  $$,
  'deleting a later intake replays the remaining ledger'
);
select lives_ok(
  $$
    select public.update_inventory_event_amount(
      (
        select event.id
        from public.inventory_events as event
        join public.inventory_products as product
          on product.id = event.product_id
        where product.name = '히알루론산 크림 테스트'
        limit 1
      ),
      3
    )
  $$,
  'updating an earlier cycle-product intake replays current stock'
);
select results_eq(
  $$
    select
      product.current_quantity,
      count(event.id)::bigint,
      min(event.quantity_before),
      min(event.quantity_delta),
      min(event.quantity_after)
    from public.inventory_products as product
    left join public.inventory_events as event
      on event.product_id = product.id
    where product.name = '히알루론산 크림 테스트'
    group by product.current_quantity
  $$,
  $$ values (3::numeric, 1::bigint, 0::numeric, 3::numeric, 3::numeric) $$,
  'the corrected cycle-product ledger contains one 3-unit intake and current stock 3'
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
select throws_ok(
  $$
    select public.create_inventory_product_with_schedules(
      p_workspace_id := '00000000-0000-0000-0000-000000000002'::uuid,
      p_name := '외부인 제품'
    )
  $$,
  '42501',
  '이 작업 공간에 제품을 만들 권한이 없습니다.',
  'the observation-model creation RPC rejects an outsider'
);

select * from finish();
rollback;
