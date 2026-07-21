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
  end case;

  if p_action not in ('open', 'remainder') then
    update public.inventory_products
    set current_quantity = v_after,
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

notify pgrst, 'reload schema';
