alter table public.inventory_products
  add column next_sale_on date,
  add column purchase_coverage_months integer,
  add column purchase_safety_quantity integer not null default 0;

alter table public.inventory_products
  add constraint inventory_products_purchase_plan_pair
    check (
      (next_sale_on is null and purchase_coverage_months is null)
      or
      (next_sale_on is not null and purchase_coverage_months is not null)
    ),
  add constraint inventory_products_purchase_coverage_range
    check (
      purchase_coverage_months is null
      or purchase_coverage_months between 1 and 36
    ),
  add constraint inventory_products_purchase_safety_nonnegative
    check (purchase_safety_quantity >= 0);

comment on column public.inventory_products.next_sale_on is
  '대량 할인 구매 수량을 계산할 다음 세일 날짜. 구매 기간과 함께 선택 입력합니다.';
comment on column public.inventory_products.purchase_coverage_months is
  '다음 세일에서 확보할 소비 기간(개월).';
comment on column public.inventory_products.purchase_safety_quantity is
  '추천 구매 수량에 더할 포장 단위 여유 재고.';

drop function public.create_inventory_product_with_stores(
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
  uuid[],
  text
);

create function public.create_inventory_product_with_stores(
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
  p_store_ids uuid[] default '{}'::uuid[],
  p_category text default '미분류',
  p_next_sale_on date default null,
  p_purchase_coverage_months integer default null,
  p_purchase_safety_quantity integer default 0
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
begin
  if (p_next_sale_on is null) <> (p_purchase_coverage_months is null) then
    raise exception using errcode = '22023',
      message = '다음 세일 날짜와 구매할 기간을 함께 입력해주세요.';
  end if;
  if p_purchase_coverage_months is not null
     and p_purchase_coverage_months not between 1 and 36 then
    raise exception using errcode = '22023',
      message = '구매할 기간은 1~36개월이어야 합니다.';
  end if;
  if coalesce(p_purchase_safety_quantity, 0) < 0 then
    raise exception using errcode = '22023',
      message = '여유 재고는 0 이상이어야 합니다.';
  end if;

  v_product := public.create_inventory_product(
    p_workspace_id := p_workspace_id,
    p_name := p_name,
    p_tracking_mode := p_tracking_mode,
    p_unit_label := p_unit_label,
    p_low_stock_threshold := p_low_stock_threshold,
    p_alert_days := p_alert_days,
    p_package_size := p_package_size,
    p_capacity_unit := p_capacity_unit,
    p_current_consumer_count := p_current_consumer_count,
    p_notes := p_notes,
    p_preferred_store_id := null,
    p_category := p_category
  );

  update public.inventory_products
  set
    next_sale_on = p_next_sale_on,
    purchase_coverage_months = p_purchase_coverage_months,
    purchase_safety_quantity = coalesce(p_purchase_safety_quantity, 0),
    updated_by = v_user_id
  where id = v_product.id;

  perform private.replace_inventory_product_stores(
    v_product.id,
    v_product.workspace_id,
    p_store_ids,
    v_user_id
  );

  select *
  into v_product
  from public.inventory_products
  where id = v_product.id;

  return v_product;
end;
$$;

comment on function public.create_inventory_product_with_stores(
  uuid, text, text, text, numeric, integer, numeric, text, integer, text,
  uuid[], text, date, integer, integer
) is
  '제품 기준 정보, 복수 쇼핑몰, 선택적 세일 구매 계획을 한 트랜잭션에서 생성합니다.';

revoke all on function public.create_inventory_product_with_stores(
  uuid, text, text, text, numeric, integer, numeric, text, integer, text,
  uuid[], text, date, integer, integer
) from public, anon;

grant execute on function public.create_inventory_product_with_stores(
  uuid, text, text, text, numeric, integer, numeric, text, integer, text,
  uuid[], text, date, integer, integer
) to authenticated;

drop function public.update_inventory_product_with_stores(
  uuid,
  text,
  text,
  numeric,
  integer,
  numeric,
  text,
  text,
  uuid[],
  text
);

create function public.update_inventory_product_with_stores(
  p_product_id uuid,
  p_name text,
  p_unit_label text,
  p_low_stock_threshold numeric,
  p_alert_days integer,
  p_package_size numeric,
  p_capacity_unit text,
  p_notes text,
  p_store_ids uuid[],
  p_category text,
  p_next_sale_on date,
  p_purchase_coverage_months integer,
  p_purchase_safety_quantity integer
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

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if v_product.id is null
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;
  if v_name = '' then
    raise exception using errcode = '22023', message = '제품명을 입력해주세요.';
  end if;
  if v_category not in ('식료품', '화장품', '생활용품', '영양제', '의복', '미분류') then
    raise exception using errcode = '22023', message = '카테고리를 확인해주세요.';
  end if;
  if v_unit_label = '' then
    raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
  end if;
  if coalesce(p_low_stock_threshold, 0) < 0 then
    raise exception using errcode = '22023', message = '구매 기준은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023', message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;
  if (p_next_sale_on is null) <> (p_purchase_coverage_months is null) then
    raise exception using errcode = '22023',
      message = '다음 세일 날짜와 구매할 기간을 함께 입력해주세요.';
  end if;
  if p_purchase_coverage_months is not null
     and p_purchase_coverage_months not between 1 and 36 then
    raise exception using errcode = '22023',
      message = '구매할 기간은 1~36개월이어야 합니다.';
  end if;
  if coalesce(p_purchase_safety_quantity, 0) < 0 then
    raise exception using errcode = '22023', message = '여유 재고는 0 이상이어야 합니다.';
  end if;

  if v_product.tracking_mode = 'cycle' then
    if coalesce(p_low_stock_threshold, 0) <> trunc(coalesce(p_low_stock_threshold, 0)) then
      raise exception using errcode = '22023',
        message = '개봉·소진 제품의 구매 기준은 정수 개수로 입력해주세요.';
    end if;
    if p_package_size is null or p_package_size <= 0 then
      raise exception using errcode = '22023', message = '제품 1개의 전체 용량을 입력해주세요.';
    end if;
    if v_capacity_unit is null then
      raise exception using errcode = '22023', message = '제품 용량 단위를 입력해주세요.';
    end if;
  else
    p_package_size := null;
    v_capacity_unit := null;
  end if;

  update public.inventory_products
  set
    name = v_name,
    category = v_category,
    unit_label = v_unit_label,
    package_size = p_package_size,
    capacity_unit = v_capacity_unit,
    low_stock_threshold = coalesce(p_low_stock_threshold, 0),
    alert_days = coalesce(p_alert_days, 30),
    next_sale_on = p_next_sale_on,
    purchase_coverage_months = p_purchase_coverage_months,
    purchase_safety_quantity = coalesce(p_purchase_safety_quantity, 0),
    notes = nullif(btrim(coalesce(p_notes, '')), ''),
    updated_by = v_user_id
  where id = v_product.id;

  perform private.replace_inventory_product_stores(
    v_product.id,
    v_product.workspace_id,
    p_store_ids,
    v_user_id
  );

  select *
  into v_product
  from public.inventory_products
  where id = v_product.id;

  return v_product;
end;
$$;

comment on function public.update_inventory_product_with_stores(
  uuid, text, text, numeric, integer, numeric, text, text, uuid[], text,
  date, integer, integer
) is
  '제품 기준 정보, 복수 쇼핑몰, 선택적 세일 구매 계획을 한 트랜잭션에서 수정합니다.';

revoke all on function public.update_inventory_product_with_stores(
  uuid, text, text, numeric, integer, numeric, text, text, uuid[], text,
  date, integer, integer
) from public, anon;

grant execute on function public.update_inventory_product_with_stores(
  uuid, text, text, numeric, integer, numeric, text, text, uuid[], text,
  date, integer, integer
) to authenticated;

notify pgrst, 'reload schema';
