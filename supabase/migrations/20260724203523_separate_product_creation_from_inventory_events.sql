-- Product creation defines the reusable item only (production migration 20260724203523).
-- Dated stock, usage, and purchase records are added separately after creation.

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
  uuid,
  text
);

create function public.create_inventory_product(
  p_workspace_id uuid,
  p_name text,
  p_tracking_mode text default 'count',
  p_unit_label text default '개',
  p_low_stock_threshold numeric default 1,
  p_alert_days integer default 30,
  p_package_size numeric default null,
  p_capacity_unit text default null,
  p_current_consumer_count integer default 1,
  p_notes text default null,
  p_preferred_store_id uuid default null,
  p_category text default '미분류'
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_category text := btrim(coalesce(p_category, ''));
  v_unit_label text := btrim(coalesce(p_unit_label, ''));
  v_capacity_unit text := nullif(btrim(coalesce(p_capacity_unit, '')), '');
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if not private.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501',
      message = '이 작업 공간에 제품을 만들 권한이 없습니다.';
  end if;
  if v_name = '' then
    raise exception using errcode = '22023', message = '제품명을 입력해주세요.';
  end if;
  if v_category not in ('식료품', '화장품', '생활용품', '영양제', '의복', '미분류') then
    raise exception using errcode = '22023', message = '카테고리를 확인해주세요.';
  end if;
  if p_tracking_mode not in ('count', 'cycle') then
    raise exception using errcode = '22023',
      message = '재고·사용 기록 방식이 올바르지 않습니다.';
  end if;
  if v_unit_label = '' then
    raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
  end if;
  if coalesce(p_low_stock_threshold, 0) < 0 then
    raise exception using errcode = '22023',
      message = '구매 기준은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023',
      message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;

  if p_preferred_store_id is not null and not exists (
    select 1
    from public.inventory_stores as store
    where store.id = p_preferred_store_id
      and store.workspace_id = p_workspace_id
      and store.is_active = true
  ) then
    raise exception using errcode = '23503',
      message = '선택한 구매처를 확인할 수 없습니다.';
  end if;

  if p_tracking_mode = 'cycle' then
    if coalesce(p_low_stock_threshold, 0) <> trunc(coalesce(p_low_stock_threshold, 0)) then
      raise exception using errcode = '22023',
        message = '개봉·소진 제품의 구매 기준은 정수 개수로 입력해주세요.';
    end if;
    if p_package_size is null or p_package_size <= 0 then
      raise exception using errcode = '22023',
        message = '제품 1개의 전체 용량을 입력해주세요.';
    end if;
    if v_capacity_unit is null then
      raise exception using errcode = '22023',
        message = '제품 용량 단위를 입력해주세요.';
    end if;
    if coalesce(p_current_consumer_count, 0) < 1 then
      raise exception using errcode = '22023',
        message = '사용 인원은 1명 이상이어야 합니다.';
    end if;
  else
    p_package_size := null;
    v_capacity_unit := null;
    p_current_consumer_count := 1;
  end if;

  insert into public.inventory_products (
    workspace_id,
    name,
    category,
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
    v_category,
    p_tracking_mode,
    v_unit_label,
    p_package_size,
    v_capacity_unit,
    0,
    false,
    coalesce(p_low_stock_threshold, 0),
    coalesce(p_alert_days, 30),
    coalesce(p_current_consumer_count, 1),
    p_preferred_store_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_user_id,
    v_user_id
  )
  returning * into v_product;

  return v_product;
end;
$$;

comment on function public.create_inventory_product(
  uuid,
  text,
  text,
  text,
  numeric,
  integer,
  numeric,
  text,
  integer,
  text,
  uuid,
  text
) is
  '날짜나 재고 이벤트 없이 재사용할 제품 기준 정보만 생성합니다.';

revoke all on function public.create_inventory_product(
  uuid,
  text,
  text,
  text,
  numeric,
  integer,
  numeric,
  text,
  integer,
  text,
  uuid,
  text
) from public, anon;

grant execute on function public.create_inventory_product(
  uuid,
  text,
  text,
  text,
  numeric,
  integer,
  numeric,
  text,
  integer,
  text,
  uuid,
  text
) to authenticated;

notify pgrst, 'reload schema';
