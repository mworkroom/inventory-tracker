-- Allow a workspace member to correct or delete any intake/use record while
-- keeping the dependent stock ledger and the product snapshot consistent.

create function private.replay_inventory_product_stock(
  p_product_id uuid,
  p_user_id uuid
)
returns public.inventory_products
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_event public.inventory_events%rowtype;
  v_running_quantity numeric(12, 3) := 0;
  v_next_quantity numeric(12, 3);
  v_new_delta numeric(12, 3);
  v_event_count integer := 0;
begin
  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found then
    raise exception using errcode = '22023',
      message = '재계산할 제품을 찾을 수 없습니다.';
  end if;

  for v_event in
    select *
    from public.inventory_events
    where product_id = v_product.id
      and workspace_id = v_product.workspace_id
    order by created_at, id
    for update
  loop
    v_event_count := v_event_count + 1;

    case v_event.event_type
      when 'intake' then
        v_new_delta := abs(v_event.quantity_delta);
        v_next_quantity := v_running_quantity + v_new_delta;
      when 'use' then
        v_new_delta := -abs(v_event.quantity_delta);
        v_next_quantity := v_running_quantity + v_new_delta;
      when 'open' then
        if v_running_quantity <= 0 then
          raise exception using errcode = '22023',
            message = format(
              '%s 개봉 기록 시점에 재고가 0이 됩니다. 앞선 입고 기록을 확인해주세요.',
              to_char(v_event.occurred_on, 'YYYY-MM-DD')
            );
        end if;
        v_new_delta := 0;
        v_next_quantity := v_running_quantity;
      when 'finish' then
        v_new_delta := -1;
        v_next_quantity := v_running_quantity - 1;
      when 'adjustment' then
        -- A stock adjustment records the actual quantity observed at that
        -- moment, so preserve its target rather than its old delta.
        v_next_quantity := v_event.quantity_after;
        v_new_delta := v_next_quantity - v_running_quantity;
      else
        raise exception using errcode = '22023',
          message = '지원하지 않는 재고 기록이 있습니다.';
    end case;

    if v_next_quantity < 0 then
      raise exception using errcode = '22023',
        message = format(
          '%s 기록을 반영하면 재고가 음수가 됩니다. 수정 수량을 확인해주세요.',
          to_char(v_event.occurred_on, 'YYYY-MM-DD')
        );
    end if;

    update public.inventory_events
    set quantity_before = v_running_quantity,
        quantity_delta = v_new_delta,
        quantity_after = v_next_quantity
    where id = v_event.id;

    v_running_quantity := v_next_quantity;
  end loop;

  update public.inventory_products
  set current_quantity = v_running_quantity,
      stock_initialized = v_event_count > 0,
      updated_by = p_user_id
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function private.replay_inventory_product_stock(uuid, uuid)
from public, anon, authenticated;

create function public.update_inventory_event_amount(
  p_event_id uuid,
  p_amount numeric
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.inventory_events%rowtype;
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_new_delta numeric(12, 3);
begin
  if v_user_id is null then
    raise exception using errcode = '42501',
      message = '로그인이 필요합니다.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023',
      message = '수정 수량은 0보다 커야 합니다.';
  end if;

  select *
  into v_event
  from public.inventory_events
  where id = p_event_id;

  if not found then
    raise exception using errcode = '22023',
      message = '수정할 재고 기록을 찾을 수 없습니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = v_event.product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id)
     or v_event.workspace_id <> v_product.workspace_id then
    raise exception using errcode = '42501',
      message = '수정할 제품을 찾을 수 없거나 권한이 없습니다.';
  end if;

  if v_event.event_type not in ('intake', 'use') then
    raise exception using errcode = '22023',
      message = '입고 또는 사용 기록의 수량만 수정할 수 있습니다.';
  end if;

  if v_product.tracking_mode = 'cycle' and trunc(p_amount) <> p_amount then
    raise exception using errcode = '22023',
      message = '개봉·소진 제품의 입고 수량은 정수로 입력해주세요.';
  end if;

  v_new_delta := case
    when v_event.event_type = 'intake' then p_amount
    else -p_amount
  end;

  if v_event.quantity_before + v_new_delta < 0 then
    raise exception using errcode = '22023',
      message = '사용 수량은 당시 재고보다 많을 수 없습니다.';
  end if;

  update public.inventory_events
  set quantity_delta = v_new_delta,
      quantity_after = quantity_before + v_new_delta
  where id = v_event.id;

  return private.replay_inventory_product_stock(v_product.id, v_user_id);
end;
$$;

create function public.delete_inventory_event(
  p_event_id uuid
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.inventory_events%rowtype;
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501',
      message = '로그인이 필요합니다.';
  end if;

  select *
  into v_event
  from public.inventory_events
  where id = p_event_id;

  if not found then
    raise exception using errcode = '22023',
      message = '삭제할 재고 기록을 찾을 수 없습니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = v_event.product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id)
     or v_event.workspace_id <> v_product.workspace_id then
    raise exception using errcode = '42501',
      message = '삭제할 제품을 찾을 수 없거나 권한이 없습니다.';
  end if;

  if v_event.event_type not in ('intake', 'use') then
    raise exception using errcode = '22023',
      message = '입고 또는 사용 기록만 삭제할 수 있습니다.';
  end if;

  delete from public.inventory_events
  where id = v_event.id;

  return private.replay_inventory_product_stock(v_product.id, v_user_id);
end;
$$;

revoke all on function public.update_inventory_event_amount(uuid, numeric)
from public, anon, authenticated;
grant execute on function public.update_inventory_event_amount(uuid, numeric)
to authenticated;

revoke all on function public.delete_inventory_event(uuid)
from public, anon, authenticated;
grant execute on function public.delete_inventory_event(uuid)
to authenticated;

comment on function private.replay_inventory_product_stock(uuid, uuid) is
  'Replays a product ledger by creation order and synchronizes the stock snapshot.';
comment on function public.update_inventory_event_amount(uuid, numeric) is
  'Updates any intake/use amount and atomically replays all dependent stock records.';
comment on function public.delete_inventory_event(uuid) is
  'Deletes an intake/use record and atomically replays all dependent stock records.';
comment on table public.inventory_events is
  'Stock, opening and depletion ledger. Clients write only through guarded RPCs that replay dependent quantities.';

notify pgrst, 'reload schema';
