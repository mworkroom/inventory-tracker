-- Let members correct a mistaken amount only when it is the latest
-- quantity-changing record for a count-based product. The event and current
-- stock snapshot are updated in the same transaction.

create function public.correct_latest_inventory_event_amount(
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
  v_product_id uuid;
  v_new_delta numeric(12, 3);
  v_new_after numeric(12, 3);
begin
  if v_user_id is null then
    raise exception using errcode = '42501',
      message = '로그인이 필요합니다.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023',
      message = '수정 수량은 0보다 커야 합니다.';
  end if;

  select product_id
  into v_product_id
  from public.inventory_events
  where id = p_event_id;

  if v_product_id is null then
    raise exception using errcode = '22023',
      message = '수정할 재고 기록을 찾을 수 없습니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = v_product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '수정할 제품을 찾을 수 없거나 권한이 없습니다.';
  end if;

  select *
  into v_event
  from public.inventory_events
  where id = p_event_id
    and product_id = v_product.id
    and workspace_id = v_product.workspace_id
  for update;

  if not found then
    raise exception using errcode = '22023',
      message = '수정할 재고 기록을 찾을 수 없습니다.';
  end if;

  if v_product.tracking_mode <> 'count'
     or v_event.event_type not in ('intake', 'use') then
    raise exception using errcode = '22023',
      message = '수량으로 관리하는 제품의 입고·사용 기록만 수정할 수 있습니다.';
  end if;

  if exists (
    select 1
    from public.inventory_events later
    where later.product_id = v_event.product_id
      and later.workspace_id = v_event.workspace_id
      and (
        later.created_at > v_event.created_at
        or (
          later.created_at = v_event.created_at
          and later.id > v_event.id
        )
      )
  ) then
    raise exception using errcode = '22023',
      message = '이후 재고 기록이 있어 이 기록은 직접 수정할 수 없습니다. 현재 재고 정정을 사용해주세요.';
  end if;

  if v_product.current_quantity <> v_event.quantity_after then
    raise exception using errcode = 'P0001',
      message = '현재 재고와 마지막 기록이 일치하지 않아 수정하지 않았습니다.';
  end if;

  v_new_delta := case
    when v_event.event_type = 'intake' then p_amount
    else -p_amount
  end;
  v_new_after := v_event.quantity_before + v_new_delta;

  if v_new_after < 0 then
    raise exception using errcode = '22023',
      message = '사용 수량은 당시 재고보다 많을 수 없습니다.';
  end if;

  update public.inventory_events
  set quantity_delta = v_new_delta,
      quantity_after = v_new_after
  where id = v_event.id;

  update public.inventory_products
  set current_quantity = v_new_after,
      updated_by = v_user_id
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.correct_latest_inventory_event_amount(uuid, numeric)
from public, anon, authenticated;
grant execute on function public.correct_latest_inventory_event_amount(uuid, numeric)
to authenticated;

comment on function public.correct_latest_inventory_event_amount(uuid, numeric) is
  'Corrects the latest count-based intake or use amount and current stock atomically.';

comment on table public.inventory_events is
  'Stock, opening and depletion ledger. Client writes are blocked; only the latest count-based intake or use amount can be corrected through a guarded RPC.';

notify pgrst, 'reload schema';
