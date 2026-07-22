-- 제품 항목 생성과 현재 재고 기준점 설정을 분리합니다.
-- 신규 제품은 stock_initialized = false로 시작하며 첫 입고 또는 재고 설정이
-- 현재 재고 계산의 기준점이 됩니다. capacity 방식은 운영 데이터에 없음을
-- 확인한 뒤 허용 목록에서 제거합니다.

begin;

do $$
begin
  if exists (
    select 1
    from public.inventory_products
    where tracking_mode = 'capacity'
  ) then
    raise exception '용량 직접 차감 제품이 남아 있어 자동 전환할 수 없습니다.';
  end if;
end;
$$;

alter table public.inventory_products
  add column if not exists stock_initialized boolean not null default false;

-- 기존 제품은 모두 최초 재고 기준점이 있는 상태로 운영되어 왔으므로 유지합니다.
update public.inventory_products
set stock_initialized = true
where stock_initialized = false;

alter table public.inventory_products
  drop constraint if exists inventory_products_tracking_mode_allowed;

alter table public.inventory_products
  add constraint inventory_products_tracking_mode_allowed
    check (tracking_mode in ('count', 'cycle'));

create or replace function public.create_inventory_product(
  p_workspace_id uuid,
  p_name text,
  p_tracking_mode text default 'count',
  p_unit_label text default '개',
  p_initial_quantity numeric default null,
  p_low_stock_threshold numeric default 1,
  p_alert_days integer default 30,
  p_package_size numeric default null,
  p_capacity_unit text default null,
  p_current_consumer_count integer default 1,
  p_notes text default null,
  p_occurred_on date default current_date,
  p_preferred_store_id uuid default null
)
returns public.inventory_products
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_unit_label text := btrim(coalesce(p_unit_label, ''));
  v_capacity_unit text := nullif(btrim(coalesce(p_capacity_unit, '')), '');
begin
  if p_occurred_on is null then
    raise exception using errcode = '22023', message = '기록 날짜를 입력해주세요.';
  end if;
  if v_name = '' then
    raise exception using errcode = '22023', message = '제품명을 입력해주세요.';
  end if;
  if p_tracking_mode not in ('count', 'cycle') then
    raise exception using errcode = '22023', message = '재고·사용 기록 방식이 올바르지 않습니다.';
  end if;
  if v_unit_label = '' then
    raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
  end if;
  if p_initial_quantity is not null and p_initial_quantity < 0 then
    raise exception using errcode = '22023', message = '현재 재고는 0 이상이어야 합니다.';
  end if;
  if coalesce(p_low_stock_threshold, 0) < 0 then
    raise exception using errcode = '22023', message = '구매 기준은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023', message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;

  if p_preferred_store_id is not null and not exists (
    select 1
    from public.inventory_stores as store
    where store.id = p_preferred_store_id
      and store.workspace_id = p_workspace_id
      and store.is_active = true
  ) then
    raise exception using errcode = '23503', message = '선택한 구매처를 확인할 수 없습니다.';
  end if;

  if p_tracking_mode = 'cycle' then
    if p_initial_quantity is not null
       and p_initial_quantity <> trunc(p_initial_quantity) then
      raise exception using errcode = '22023', message = '개봉·소진 제품의 현재 재고는 정수 개수로 입력해주세요.';
    end if;
    if p_package_size is null or p_package_size <= 0 then
      raise exception using errcode = '22023', message = '제품 1개의 전체 용량을 입력해주세요.';
    end if;
    if v_capacity_unit is null then
      raise exception using errcode = '22023', message = '제품 용량 단위를 입력해주세요.';
    end if;
    if coalesce(p_current_consumer_count, 0) < 1 then
      raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
    end if;
  else
    p_package_size := null;
    v_capacity_unit := null;
    p_current_consumer_count := 1;
  end if;

  insert into public.inventory_products (
    workspace_id,
    name,
    tracking_mode,
    unit_label,
    package_size,
    capacity_unit,
    current_quantity,
    stock_initialized,
    low_stock_threshold,
    alert_days,
    current_consumer_count,
    preferred_store_id,
    notes,
    created_by,
    updated_by
  )
  values (
    p_workspace_id,
    v_name,
    p_tracking_mode,
    v_unit_label,
    p_package_size,
    v_capacity_unit,
    coalesce(p_initial_quantity, 0),
    p_initial_quantity is not null,
    coalesce(p_low_stock_threshold, 0),
    coalesce(p_alert_days, 30),
    coalesce(p_current_consumer_count, 1),
    p_preferred_store_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning * into v_product;

  if p_initial_quantity is not null then
    insert into public.inventory_events (
      workspace_id,
      product_id,
      event_type,
      quantity_delta,
      quantity_before,
      quantity_after,
      occurred_on,
      note,
      created_by
    )
    values (
      v_product.workspace_id,
      v_product.id,
      'adjustment',
      v_product.current_quantity,
      0,
      v_product.current_quantity,
      p_occurred_on,
      '최초 재고 등록',
      auth.uid()
    );
  end if;

  return v_product;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = '같은 이름의 제품이 이미 있습니다.';
end;
$$;

revoke all on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid
) from public, anon;
grant execute on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid
) to authenticated;

create or replace function public.record_inventory_action(
  p_product_id uuid,
  p_action text,
  p_amount numeric default null,
  p_target_quantity numeric default null,
  p_occurred_on date default current_date,
  p_consumer_count integer default null,
  p_note text default null
)
returns public.inventory_products
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_before numeric(12, 3);
  v_after numeric(12, 3);
  v_delta numeric(12, 3) := 0;
  v_event_consumer_count integer := null;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_open_remaining numeric(12, 3);
  v_was_initialized boolean;
begin
  if p_action not in ('intake', 'use', 'open', 'finish', 'remainder', 'adjustment') then
    raise exception using errcode = '22023', message = '지원하지 않는 재고 기록입니다.';
  end if;
  if p_occurred_on is null then
    raise exception using errcode = '22023', message = '기록 날짜를 입력해주세요.';
  end if;

  select * into v_product
  from public.inventory_products
  where id = p_product_id and is_archived = false
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;

  v_was_initialized := v_product.stock_initialized;
  if not v_was_initialized and p_action not in ('intake', 'adjustment') then
    raise exception using errcode = '22023', message = '먼저 첫 입고를 기록하거나 현재 재고를 설정해주세요.';
  end if;

  v_before := v_product.current_quantity;
  v_after := v_before;

  case p_action
    when 'intake' then
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023', message = '입고 수량은 0보다 커야 합니다.';
      end if;
      if v_product.tracking_mode = 'cycle' and p_amount <> trunc(p_amount) then
        raise exception using errcode = '22023', message = '개봉·소진 제품의 입고 수량은 정수로 입력해주세요.';
      end if;
      v_after := v_before + p_amount;
      v_delta := p_amount;

    when 'use' then
      if v_product.tracking_mode = 'cycle' then
        raise exception using errcode = '22023', message = '이 제품은 개봉·소진 버튼으로 기록해주세요.';
      end if;
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023', message = '사용 수량은 0보다 커야 합니다.';
      end if;
      if p_amount > v_before then
        raise exception using errcode = '22023', message = '현재 재고보다 많이 사용할 수 없습니다.';
      end if;
      v_after := v_before - p_amount;
      v_delta := -p_amount;

    when 'open' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023', message = '이 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is not null then
        raise exception using errcode = '22023', message = '이미 사용 중인 제품이 있습니다.';
      end if;
      if v_before < 1 then
        raise exception using errcode = '22023', message = '개봉할 재고가 없습니다.';
      end if;
      if coalesce(p_consumer_count, v_product.current_consumer_count) < 1 then
        raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
      end if;

      v_open_remaining := coalesce(p_amount, v_product.active_remaining_quantity, v_product.package_size);
      if v_open_remaining is null or v_open_remaining < 0 then
        raise exception using errcode = '22023', message = '현재 제품 잔량은 0 이상이어야 합니다.';
      end if;
      if v_product.package_size is not null and v_open_remaining > v_product.package_size then
        raise exception using errcode = '22023', message = '현재 제품 잔량은 제품 전체 용량보다 클 수 없습니다.';
      end if;

      v_event_consumer_count := coalesce(p_consumer_count, v_product.current_consumer_count);
      v_note := coalesce(v_note, '개봉 잔량 ' || trim(to_char(v_open_remaining, 'FM999999990.###')) || coalesce(v_product.capacity_unit, ''));

      update public.inventory_products
      set active_opened_on = p_occurred_on,
          active_consumer_count = v_event_consumer_count,
          active_remaining_quantity = v_open_remaining,
          active_remaining_updated_on = p_occurred_on,
          current_consumer_count = v_event_consumer_count,
          updated_by = auth.uid()
      where id = v_product.id
      returning * into v_product;

    when 'finish' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023', message = '이 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is null then
        raise exception using errcode = '22023', message = '먼저 새 제품을 개봉해주세요.';
      end if;
      if p_occurred_on < v_product.active_opened_on then
        raise exception using errcode = '22023', message = '소진일은 개봉일보다 빠를 수 없습니다.';
      end if;
      if v_before < 1 then
        raise exception using errcode = '22023', message = '소진 처리할 재고가 없습니다.';
      end if;

      v_after := v_before - 1;
      v_delta := -1;
      v_event_consumer_count := coalesce(v_product.active_consumer_count, v_product.current_consumer_count, 1);

      insert into public.inventory_usage_cycles (
        workspace_id, product_id, opened_on, finished_on, duration_days,
        package_size, capacity_unit, consumer_count, created_by
      ) values (
        v_product.workspace_id, v_product.id, v_product.active_opened_on,
        p_occurred_on, (p_occurred_on - v_product.active_opened_on) + 1,
        v_product.package_size, v_product.capacity_unit,
        v_event_consumer_count, auth.uid()
      );

    when 'remainder' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023', message = '현재 제품 잔량은 개봉·소진 제품에서만 기록할 수 있습니다.';
      end if;
      if v_product.active_opened_on is null then
        raise exception using errcode = '22023', message = '먼저 새 제품을 개봉해주세요.';
      end if;
      if p_occurred_on < v_product.active_opened_on then
        raise exception using errcode = '22023', message = '잔량 확인일은 개봉일보다 빠를 수 없습니다.';
      end if;
      if p_amount is null or p_amount < 0 then
        raise exception using errcode = '22023', message = '현재 제품 잔량은 0 이상이어야 합니다.';
      end if;
      if v_product.package_size is not null and p_amount > v_product.package_size then
        raise exception using errcode = '22023', message = '현재 제품 잔량은 제품 전체 용량보다 클 수 없습니다.';
      end if;

      v_note := coalesce(v_note, trim(to_char(p_amount, 'FM999999990.###')) || coalesce(v_product.capacity_unit, ''));
      update public.inventory_products
      set active_remaining_quantity = p_amount,
          active_remaining_updated_on = p_occurred_on,
          updated_by = auth.uid()
      where id = v_product.id
      returning * into v_product;

    when 'adjustment' then
      if p_target_quantity is null or p_target_quantity < 0 then
        raise exception using errcode = '22023', message = '실제 재고는 0 이상이어야 합니다.';
      end if;
      if v_product.tracking_mode = 'cycle' and p_target_quantity <> trunc(p_target_quantity) then
        raise exception using errcode = '22023', message = '개봉·소진 제품의 재고는 정수 개수로 입력해주세요.';
      end if;
      v_after := p_target_quantity;
      v_delta := v_after - v_before;
      if not v_was_initialized then
        v_note := coalesce(v_note, '재고 기준 설정');
      end if;
  end case;

  if p_action not in ('open', 'remainder') then
    update public.inventory_products
    set current_quantity = v_after,
        stock_initialized = case
          when p_action in ('intake', 'adjustment') then true
          else stock_initialized
        end,
        active_opened_on = case when p_action = 'finish' or (p_action = 'adjustment' and v_after < 1) then null else active_opened_on end,
        active_consumer_count = case when p_action = 'finish' or (p_action = 'adjustment' and v_after < 1) then null else active_consumer_count end,
        active_remaining_quantity = case when p_action = 'finish' or (p_action = 'adjustment' and v_after < 1) then null else active_remaining_quantity end,
        active_remaining_updated_on = case when p_action = 'finish' or (p_action = 'adjustment' and v_after < 1) then null else active_remaining_updated_on end,
        updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;
  end if;

  insert into public.inventory_events (
    workspace_id, product_id, event_type, quantity_delta, quantity_before,
    quantity_after, occurred_on, consumer_count, note, created_by
  ) values (
    v_product.workspace_id, v_product.id, p_action, v_delta, v_before,
    v_after, p_occurred_on, v_event_consumer_count, v_note, auth.uid()
  );

  return v_product;
end;
$$;

revoke all on function public.record_inventory_action(uuid, text, numeric, numeric, date, integer, text) from public, anon;
grant execute on function public.record_inventory_action(uuid, text, numeric, numeric, date, integer, text) to authenticated;

create or replace function public.delete_unused_inventory_product(
  p_product_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_event_count integer;
  v_baseline_event_count integer;
  v_cycle_count integer;
  v_purchase_count integer;
begin
  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = 'P0002', message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;

  if v_product.active_opened_on is not null then
    raise exception using errcode = '22023', message = '이미 사용을 시작한 제품은 삭제할 수 없습니다. 제품 보관을 사용해주세요.';
  end if;

  select count(*)::integer,
         count(*) filter (
           where event_type = 'adjustment'
             and quantity_before = 0
             and note in ('최초 재고 등록', '재고 기준 설정')
         )::integer
  into v_event_count, v_baseline_event_count
  from public.inventory_events
  where product_id = v_product.id
    and workspace_id = v_product.workspace_id;

  select count(*)::integer
  into v_cycle_count
  from public.inventory_usage_cycles
  where product_id = v_product.id
    and workspace_id = v_product.workspace_id;

  select count(*)::integer
  into v_purchase_count
  from public.inventory_purchases
  where product_id = v_product.id
    and workspace_id = v_product.workspace_id;

  if v_event_count > 1
     or (v_event_count = 1 and v_baseline_event_count <> 1)
     or v_cycle_count <> 0
     or v_purchase_count <> 0 then
    raise exception using errcode = '22023', message = '실사용 또는 구매 기록이 있는 제품은 삭제할 수 없습니다. 제품 보관을 사용해주세요.';
  end if;

  delete from public.inventory_events
  where product_id = v_product.id
    and workspace_id = v_product.workspace_id;

  delete from public.inventory_products
  where id = v_product.id
    and workspace_id = v_product.workspace_id;

  return v_product.id;
end;
$$;

revoke all on function public.delete_unused_inventory_product(uuid)
from public, anon, authenticated;
grant execute on function public.delete_unused_inventory_product(uuid)
to authenticated;

comment on column public.inventory_products.stock_initialized is
  '현재 재고 기준점이 설정되었는지 나타냅니다. 첫 입고 또는 재고 설정 시 true가 됩니다.';
comment on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid
) is '현재 재고 입력 없이 제품 항목을 만들 수 있습니다.';
comment on function public.delete_unused_inventory_product(uuid) is
  '재고 기준 설정 외의 실사용·구매 기록이 없는 제품만 영구 삭제합니다.';

notify pgrst, 'reload schema';

commit;
