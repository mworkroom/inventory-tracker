-- Product lifecycle management
-- - Archive keeps all inventory, usage-cycle, and purchase history.
-- - Permanent deletion is allowed only for a product that has never been used:
--   exactly one automatically-created initial adjustment event and no purchases/cycles.

create or replace function public.set_inventory_product_archived(
  p_product_id uuid,
  p_archived boolean
)
returns public.inventory_products
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
begin
  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;

  if p_archived and v_product.active_opened_on is not null then
    raise exception using errcode = '22023', message = '사용 중인 제품은 다 쓴 뒤 보관해주세요.';
  end if;

  update public.inventory_products
  set is_archived = p_archived,
      updated_by = auth.uid()
  where id = v_product.id
  returning * into v_product;

  return v_product;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = '같은 이름의 활성 제품이 있어 복원할 수 없습니다.';
end;
$$;

revoke all on function public.set_inventory_product_archived(uuid, boolean)
from public, anon;
grant execute on function public.set_inventory_product_archived(uuid, boolean)
to authenticated;

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
  v_initial_event_count integer;
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
             and note = '최초 재고 등록'
         )::integer
  into v_event_count, v_initial_event_count
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

  if v_event_count <> 1
     or v_initial_event_count <> 1
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

comment on function public.set_inventory_product_archived(uuid, boolean) is
  '제품 기록을 유지한 채 목록에서 보관하거나 복원합니다.';
comment on function public.delete_unused_inventory_product(uuid) is
  '최초 재고 등록 외의 기록이 전혀 없는 잘못 만든 제품만 영구 삭제합니다.';

notify pgrst, 'reload schema';
