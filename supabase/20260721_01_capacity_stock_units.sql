-- Capacity-tracked products store current_quantity in their capacity unit (g, ml, etc.).
-- Count-tracked products continue to store current_quantity in a user-defined count unit.

create or replace function public.create_inventory_product(
  p_workspace_id uuid,
  p_name text,
  p_tracking_mode text default 'count',
  p_unit_label text default '개',
  p_initial_quantity numeric default 0,
  p_low_stock_threshold numeric default 1,
  p_alert_days integer default 30,
  p_package_size numeric default null,
  p_capacity_unit text default null,
  p_current_consumer_count integer default 1,
  p_notes text default null,
  p_occurred_on date default current_date
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
    raise exception using errcode = '22023', message = '재고 기준이 올바르지 않습니다.';
  end if;
  if coalesce(p_initial_quantity, 0) < 0 then
    raise exception using errcode = '22023', message = '현재 재고는 0 이상이어야 합니다.';
  end if;
  if coalesce(p_low_stock_threshold, 0) < 0 then
    raise exception using errcode = '22023', message = '구매 기준은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023', message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;

  if p_tracking_mode = 'cycle' then
    if v_capacity_unit is null then
      raise exception using errcode = '22023', message = '용량 단위를 입력해주세요.';
    end if;
    if p_package_size is null or p_package_size <= 0 then
      raise exception using errcode = '22023', message = '새 제품 1개의 전체 용량을 입력해주세요.';
    end if;
    if coalesce(p_current_consumer_count, 0) < 1 then
      raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
    end if;
    v_unit_label := v_capacity_unit;
  else
    if v_unit_label = '' then
      raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
    end if;
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
    low_stock_threshold,
    alert_days,
    current_consumer_count,
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
    coalesce(p_low_stock_threshold, 0),
    coalesce(p_alert_days, 30),
    coalesce(p_current_consumer_count, 1),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning * into v_product;

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

  return v_product;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = '같은 이름의 제품이 이미 있습니다.';
end;
$$;

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
begin
  if p_action not in ('intake', 'use', 'open', 'finish', 'adjustment') then
    raise exception using errcode = '22023', message = '지원하지 않는 재고 기록입니다.';
  end if;
  if p_occurred_on is null then
    raise exception using errcode = '22023', message = '기록 날짜를 입력해주세요.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
    and is_archived = false
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;

  v_before := v_product.current_quantity;
  v_after := v_before;

  case p_action
    when 'intake' then
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023', message = '입고 수량은 0보다 커야 합니다.';
      end if;
      v_after := v_before + p_amount;
      v_delta := p_amount;

    when 'use' then
      if v_product.tracking_mode <> 'count' then
        raise exception using errcode = '22023', message = '용량 제품은 개봉·소진으로 기록해주세요.';
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
        raise exception using errcode = '22023', message = '개수 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is not null then
        raise exception using errcode = '22023', message = '이미 사용 중인 제품이 있습니다.';
      end if;
      if v_before <= 0 then
        raise exception using errcode = '22023', message = '개봉할 재고가 없습니다.';
      end if;
      if coalesce(p_consumer_count, v_product.current_consumer_count) < 1 then
        raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
      end if;
      v_event_consumer_count := coalesce(p_consumer_count, v_product.current_consumer_count);

      update public.inventory_products
      set active_opened_on = p_occurred_on,
          active_consumer_count = v_event_consumer_count,
          current_consumer_count = v_event_consumer_count,
          updated_by = auth.uid()
      where id = v_product.id
      returning * into v_product;

    when 'finish' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023', message = '개수 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is null then
        raise exception using errcode = '22023', message = '먼저 새 제품을 개봉해주세요.';
      end if;
      if p_occurred_on < v_product.active_opened_on then
        raise exception using errcode = '22023', message = '소진일은 개봉일보다 빠를 수 없습니다.';
      end if;
      if v_before <= 0 then
        raise exception using errcode = '22023', message = '소진 처리할 재고가 없습니다.';
      end if;

      v_delta := -least(v_before, coalesce(v_product.package_size, v_before));
      v_after := v_before + v_delta;
      v_event_consumer_count := coalesce(v_product.active_consumer_count, v_product.current_consumer_count, 1);

      insert into public.inventory_usage_cycles (
        workspace_id,
        product_id,
        opened_on,
        finished_on,
        duration_days,
        package_size,
        capacity_unit,
        consumer_count,
        created_by
      )
      values (
        v_product.workspace_id,
        v_product.id,
        v_product.active_opened_on,
        p_occurred_on,
        (p_occurred_on - v_product.active_opened_on) + 1,
        v_product.package_size,
        v_product.capacity_unit,
        v_event_consumer_count,
        auth.uid()
      );

    when 'adjustment' then
      if p_target_quantity is null or p_target_quantity < 0 then
        raise exception using errcode = '22023', message = '실제 재고는 0 이상이어야 합니다.';
      end if;
      v_after := p_target_quantity;
      v_delta := v_after - v_before;
  end case;

  if p_action <> 'open' then
    update public.inventory_products
    set current_quantity = v_after,
        active_opened_on = case
          when p_action = 'finish' or (p_action = 'adjustment' and v_after <= 0)
            then null
          else active_opened_on
        end,
        active_consumer_count = case
          when p_action = 'finish' or (p_action = 'adjustment' and v_after <= 0)
            then null
          else active_consumer_count
        end,
        updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;
  end if;

  insert into public.inventory_events (
    workspace_id,
    product_id,
    event_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    occurred_on,
    consumer_count,
    note,
    created_by
  )
  values (
    v_product.workspace_id,
    v_product.id,
    p_action,
    v_delta,
    v_before,
    v_after,
    p_occurred_on,
    v_event_consumer_count,
    v_note,
    auth.uid()
  );

  return v_product;
end;
$$;

update public.inventory_products
set unit_label = capacity_unit,
    updated_at = now()
where tracking_mode = 'cycle'
  and capacity_unit is not null
  and unit_label is distinct from capacity_unit;
