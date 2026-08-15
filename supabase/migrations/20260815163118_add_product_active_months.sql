alter table public.inventory_products
  add column active_months integer[];

alter table public.inventory_products
  add constraint inventory_products_active_months_valid
    check (
      active_months is null
      or (
        cardinality(active_months) between 1 and 11
        and active_months <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        and array_position(active_months, null) is null
      )
    );

comment on column public.inventory_products.active_months is
  '제품을 실제로 소비하는 달. null은 연중 사용이며, 계절 제품은 1~12월 중 사용하는 달만 저장합니다.';

create function public.create_inventory_product_with_stores(
  p_workspace_id uuid,
  p_name text,
  p_tracking_mode text,
  p_unit_label text,
  p_low_stock_threshold numeric,
  p_alert_days integer,
  p_package_size numeric,
  p_capacity_unit text,
  p_current_consumer_count integer,
  p_notes text,
  p_store_ids uuid[],
  p_category text,
  p_next_sale_on date,
  p_purchase_coverage_months integer,
  p_purchase_safety_quantity integer,
  p_active_months integer[]
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_active_months integer[];
begin
  if p_active_months is not null then
    select array_agg(distinct month_number order by month_number)
    into v_active_months
    from unnest(p_active_months) as month_number;

    if cardinality(p_active_months) not between 1 and 11
       or array_position(p_active_months, null) is not null
       or cardinality(v_active_months) <> cardinality(p_active_months)
       or v_active_months[1] < 1
       or v_active_months[cardinality(v_active_months)] > 12 then
      raise exception using errcode = '22023',
        message = '사용 시기는 1~12월 중 중복 없이 한 달 이상 선택해주세요.';
    end if;
  end if;

  v_product := public.create_inventory_product_with_stores(
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
    p_store_ids := p_store_ids,
    p_category := p_category,
    p_next_sale_on := p_next_sale_on,
    p_purchase_coverage_months := p_purchase_coverage_months,
    p_purchase_safety_quantity := p_purchase_safety_quantity
  );

  update public.inventory_products
  set active_months = v_active_months
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

comment on function public.create_inventory_product_with_stores(
  uuid, text, text, text, numeric, integer, numeric, text, integer, text,
  uuid[], text, date, integer, integer, integer[]
) is
  '제품 기준 정보, 복수 쇼핑몰, 선택적 세일 계획과 사용 시기를 한 트랜잭션에서 생성합니다.';

revoke all on function public.create_inventory_product_with_stores(
  uuid, text, text, text, numeric, integer, numeric, text, integer, text,
  uuid[], text, date, integer, integer, integer[]
) from public, anon;

grant execute on function public.create_inventory_product_with_stores(
  uuid, text, text, text, numeric, integer, numeric, text, integer, text,
  uuid[], text, date, integer, integer, integer[]
) to authenticated;

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
  p_purchase_safety_quantity integer,
  p_active_months integer[]
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_active_months integer[];
begin
  if p_active_months is not null then
    select array_agg(distinct month_number order by month_number)
    into v_active_months
    from unnest(p_active_months) as month_number;

    if cardinality(p_active_months) not between 1 and 11
       or array_position(p_active_months, null) is not null
       or cardinality(v_active_months) <> cardinality(p_active_months)
       or v_active_months[1] < 1
       or v_active_months[cardinality(v_active_months)] > 12 then
      raise exception using errcode = '22023',
        message = '사용 시기는 1~12월 중 중복 없이 한 달 이상 선택해주세요.';
    end if;
  end if;

  v_product := public.update_inventory_product_with_stores(
    p_product_id := p_product_id,
    p_name := p_name,
    p_unit_label := p_unit_label,
    p_low_stock_threshold := p_low_stock_threshold,
    p_alert_days := p_alert_days,
    p_package_size := p_package_size,
    p_capacity_unit := p_capacity_unit,
    p_notes := p_notes,
    p_store_ids := p_store_ids,
    p_category := p_category,
    p_next_sale_on := p_next_sale_on,
    p_purchase_coverage_months := p_purchase_coverage_months,
    p_purchase_safety_quantity := p_purchase_safety_quantity
  );

  update public.inventory_products
  set active_months = v_active_months
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

comment on function public.update_inventory_product_with_stores(
  uuid, text, text, numeric, integer, numeric, text, text, uuid[], text,
  date, integer, integer, integer[]
) is
  '제품 기준 정보, 복수 쇼핑몰, 선택적 세일 계획과 사용 시기를 한 트랜잭션에서 수정합니다.';

revoke all on function public.update_inventory_product_with_stores(
  uuid, text, text, numeric, integer, numeric, text, text, uuid[], text,
  date, integer, integer, integer[]
) from public, anon;

grant execute on function public.update_inventory_product_with_stores(
  uuid, text, text, numeric, integer, numeric, text, text, uuid[], text,
  date, integer, integer, integer[]
) to authenticated;

notify pgrst, 'reload schema';
