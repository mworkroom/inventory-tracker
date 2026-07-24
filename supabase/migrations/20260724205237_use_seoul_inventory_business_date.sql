-- Inventory records use Korea's calendar date while timestamps remain in UTC.
-- Production migration version: 20260724205237.

alter table public.inventory_events
  alter column occurred_on
  set default ((now() at time zone 'Asia/Seoul')::date);

create or replace function private.set_usage_cycle_duration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.opened_on is null or new.finished_on is null then
    raise exception using errcode = '22023',
      message = '개봉일과 다 쓴 날을 모두 입력해주세요.';
  end if;
  if new.finished_on < new.opened_on then
    raise exception using errcode = '22023',
      message = '다 쓴 날은 개봉일보다 빠를 수 없습니다.';
  end if;
  if new.finished_on > (now() at time zone 'Asia/Seoul')::date then
    raise exception using errcode = '22023',
      message = '미래 날짜는 사용 주기로 저장할 수 없습니다.';
  end if;
  if coalesce(new.consumer_count, 0) < 1 then
    raise exception using errcode = '22023',
      message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  new.duration_days := (new.finished_on - new.opened_on) + 1;
  return new;
end;
$$;

create or replace function public.record_inventory_action(
  p_product_id uuid,
  p_action text,
  p_amount numeric default null,
  p_target_quantity numeric default null,
  p_occurred_on date default ((now() at time zone 'Asia/Seoul')::date),
  p_consumer_count integer default null,
  p_note text default null
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_before numeric(12, 3);
  v_after numeric(12, 3);
  v_delta numeric(12, 3) := 0;
  v_event_consumer_count integer := null;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_was_initialized boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_action not in ('intake', 'use', 'open', 'finish', 'adjustment') then
    raise exception using errcode = '22023',
      message = '지원하지 않는 재고 기록입니다.';
  end if;
  if p_occurred_on is null
     or p_occurred_on > (now() at time zone 'Asia/Seoul')::date then
    raise exception using errcode = '22023',
      message = '기록 날짜는 오늘 또는 과거 날짜여야 합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
    and is_archived = false
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;

  v_was_initialized := v_product.stock_initialized;
  if not v_was_initialized and p_action not in ('intake', 'adjustment') then
    raise exception using errcode = '22023',
      message = '먼저 첫 입고를 기록하거나 현재 재고를 설정해주세요.';
  end if;

  v_before := v_product.current_quantity;
  v_after := v_before;

  case p_action
    when 'intake' then
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023',
          message = '입고 수량은 0보다 커야 합니다.';
      end if;
      if v_product.tracking_mode = 'cycle'
         and p_amount <> trunc(p_amount) then
        raise exception using errcode = '22023',
          message = '개봉·소진 제품의 입고 수량은 정수로 입력해주세요.';
      end if;
      v_after := v_before + p_amount;
      v_delta := p_amount;

    when 'use' then
      if v_product.tracking_mode = 'cycle' then
        raise exception using errcode = '22023',
          message = '이 제품은 개봉·소진 버튼으로 기록해주세요.';
      end if;
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023',
          message = '사용 수량은 0보다 커야 합니다.';
      end if;
      if p_amount > v_before then
        raise exception using errcode = '22023',
          message = '현재 재고보다 많이 사용할 수 없습니다.';
      end if;
      v_after := v_before - p_amount;
      v_delta := -p_amount;

    when 'open' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023',
          message = '이 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is not null then
        raise exception using errcode = '22023',
          message = '이미 사용 중인 제품이 있습니다.';
      end if;
      if v_before < 1 then
        raise exception using errcode = '22023',
          message = '개봉할 재고가 없습니다.';
      end if;
      if coalesce(p_consumer_count, v_product.current_consumer_count) < 1 then
        raise exception using errcode = '22023',
          message = '사용 인원은 1명 이상이어야 합니다.';
      end if;

      v_event_consumer_count :=
        coalesce(p_consumer_count, v_product.current_consumer_count);

      update public.inventory_products
      set active_opened_on = p_occurred_on,
          active_consumer_count = v_event_consumer_count,
          current_consumer_count = v_event_consumer_count,
          updated_by = v_user_id
      where id = v_product.id
      returning * into v_product;

    when 'finish' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023',
          message = '이 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is null then
        raise exception using errcode = '22023',
          message = '먼저 새 제품을 개봉해주세요.';
      end if;
      if p_occurred_on < v_product.active_opened_on then
        raise exception using errcode = '22023',
          message = '소진일은 개봉일보다 빠를 수 없습니다.';
      end if;
      if v_before < 1 then
        raise exception using errcode = '22023',
          message = '소진 처리할 재고가 없습니다.';
      end if;

      v_after := v_before - 1;
      v_delta := -1;
      v_event_consumer_count := coalesce(
        v_product.active_consumer_count,
        v_product.current_consumer_count,
        1
      );

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
        v_user_id
      );

    when 'adjustment' then
      if p_target_quantity is null or p_target_quantity < 0 then
        raise exception using errcode = '22023',
          message = '실제 재고는 0 이상이어야 합니다.';
      end if;
      if v_product.tracking_mode = 'cycle'
         and p_target_quantity <> trunc(p_target_quantity) then
        raise exception using errcode = '22023',
          message = '개봉·소진 제품의 재고는 정수 개수로 입력해주세요.';
      end if;
      v_after := p_target_quantity;
      v_delta := v_after - v_before;
      if not v_was_initialized then
        v_note := coalesce(v_note, '재고 기준 설정');
      end if;
  end case;

  if p_action <> 'open' then
    update public.inventory_products
    set current_quantity = v_after,
        stock_initialized = case
          when p_action in ('intake', 'adjustment') then true
          else stock_initialized
        end,
        active_opened_on = case
          when p_action = 'finish'
            or (p_action = 'adjustment' and v_after < 1)
            then null
          else active_opened_on
        end,
        active_consumer_count = case
          when p_action = 'finish'
            or (p_action = 'adjustment' and v_after < 1)
            then null
          else active_consumer_count
        end,
        updated_by = v_user_id
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
    v_user_id
  );

  return v_product;
end;
$$;

create or replace function public.update_active_usage(
  p_product_id uuid,
  p_opened_on date,
  p_consumer_count integer
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_open_event_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_opened_on is null
     or p_opened_on > (now() at time zone 'Asia/Seoul')::date then
    raise exception using errcode = '22023',
      message = '개봉일은 오늘 또는 과거 날짜여야 합니다.';
  end if;
  if coalesce(p_consumer_count, 0) < 1 then
    raise exception using errcode = '22023',
      message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '수정할 제품을 찾을 수 없거나 권한이 없습니다.';
  end if;
  if v_product.tracking_mode <> 'cycle'
     or v_product.active_opened_on is null then
    raise exception using errcode = '22023',
      message = '현재 사용 중인 개봉·소진 제품만 수정할 수 있습니다.';
  end if;

  select id
  into v_open_event_id
  from public.inventory_events
  where workspace_id = v_product.workspace_id
    and product_id = v_product.id
    and event_type = 'open'
    and occurred_on = v_product.active_opened_on
  order by created_at desc
  limit 1
  for update;

  if v_open_event_id is null then
    raise exception using errcode = 'P0001',
      message = '연결된 개봉 기록을 찾지 못해 수정하지 않았습니다.';
  end if;

  update public.inventory_products
  set active_opened_on = p_opened_on,
      active_consumer_count = p_consumer_count,
      current_consumer_count = p_consumer_count,
      updated_by = v_user_id
  where id = v_product.id
  returning * into v_product;

  update public.inventory_events
  set occurred_on = p_opened_on,
      consumer_count = p_consumer_count
  where id = v_open_event_id;

  return v_product;
end;
$$;

comment on function public.record_inventory_action(
  uuid,
  text,
  numeric,
  numeric,
  date,
  integer,
  text
) is
  '한국 날짜를 기준으로 입고·사용·개봉·소진·재고 정정을 원자적으로 기록합니다.';

comment on function public.update_active_usage(uuid, date, integer) is
  '한국 날짜를 기준으로 현재 개봉일과 사용 인원을 함께 수정합니다.';

notify pgrst, 'reload schema';
