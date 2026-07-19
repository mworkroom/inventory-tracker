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
      if v_product.tracking_mode = 'cycle' and p_amount <> trunc(p_amount) then
        raise exception using errcode = '22023', message = '개봉·소진 방식의 입고 수량은 정수로 입력해주세요.';
      end if;
      v_after := v_before + p_amount;
      v_delta := p_amount;

    when 'use' then
      if v_product.tracking_mode <> 'count' then
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
        raise exception using errcode = '22023', message = '개수 방식 제품은 사용 수량으로 기록해주세요.';
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
        raise exception using errcode = '22023', message = '개수 방식 제품은 사용 수량으로 기록해주세요.';
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
      if v_product.tracking_mode = 'cycle' and p_target_quantity <> trunc(p_target_quantity) then
        raise exception using errcode = '22023', message = '개봉·소진 방식의 재고 수량은 정수로 입력해주세요.';
      end if;
      v_after := p_target_quantity;
      v_delta := v_after - v_before;
  end case;

  if p_action <> 'open' then
    update public.inventory_products
    set current_quantity = v_after,
        active_opened_on = case
          when p_action = 'finish' or (p_action = 'adjustment' and v_after < 1)
            then null
          else active_opened_on
        end,
        active_consumer_count = case
          when p_action = 'finish' or (p_action = 'adjustment' and v_after < 1)
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

alter table public.inventory_products enable row level security;

alter table public.inventory_events enable row level security;

alter table public.inventory_usage_cycles enable row level security;

revoke all on table public.inventory_products from public, anon, authenticated;

revoke all on table public.inventory_events from public, anon, authenticated;

revoke all on table public.inventory_usage_cycles from public, anon, authenticated;

grant select, insert, update on table public.inventory_products to authenticated;

grant select, insert on table public.inventory_events to authenticated;

grant select, insert on table public.inventory_usage_cycles to authenticated;

drop policy if exists inventory_products_select_member on public.inventory_products;

create policy inventory_products_select_member
on public.inventory_products
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists inventory_products_insert_member on public.inventory_products;

create policy inventory_products_insert_member
on public.inventory_products
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists inventory_products_update_member on public.inventory_products;

create policy inventory_products_update_member
on public.inventory_products
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check (
  (select private.is_workspace_member(workspace_id))
  and updated_by = (select auth.uid())
);
