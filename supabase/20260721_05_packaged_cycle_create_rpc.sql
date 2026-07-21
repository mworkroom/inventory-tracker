drop function if exists public.create_inventory_product(
  uuid,
  text,
  text,
  text,
  numeric,
  numeric,
  integer,
  numeric,
  text,
  integer,
  text,
  date,
  uuid
);

create function public.create_inventory_product(
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
  if p_tracking_mode not in ('count', 'cycle', 'capacity') then
    raise exception using errcode = '22023', message = '재고·사용 기록 방식이 올바르지 않습니다.';
  end if;
  if v_unit_label = '' then
    raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
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
    if coalesce(p_initial_quantity, 0) <> trunc(coalesce(p_initial_quantity, 0)) then
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
    coalesce(p_low_stock_threshold, 0),
    coalesce(p_alert_days, 30),
    coalesce(p_current_consumer_count, 1),
    p_preferred_store_id,
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

revoke all on function public.create_inventory_product(
  uuid,
  text,
  text,
  text,
  numeric,
  numeric,
  integer,
  numeric,
  text,
  integer,
  text,
  date,
  uuid
)
from public, anon;

grant execute on function public.create_inventory_product(
  uuid,
  text,
  text,
  text,
  numeric,
  numeric,
  integer,
  numeric,
  text,
  integer,
  text,
  date,
  uuid
)
to authenticated;
