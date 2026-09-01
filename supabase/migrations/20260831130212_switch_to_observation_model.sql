-- Stage 2 switches application readers and writers to the observation-first
-- Production migration version: 20260831130212.
-- model while retaining legacy columns and RPCs for rollback compatibility.

alter table public.inventory_products
  drop constraint inventory_products_cycle_package_required,
  drop constraint inventory_products_count_package_empty;

create function private.replace_inventory_product_sale_schedules(
  p_product_id uuid,
  p_workspace_id uuid,
  p_schedules jsonb,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schedules jsonb := coalesce(p_schedules, '[]'::jsonb);
  v_schedule record;
  v_max_day integer;
begin
  if jsonb_typeof(v_schedules) <> 'array' then
    raise exception using errcode = '22023',
      message = '정기 세일 일정 형식을 확인해주세요.';
  end if;

  delete from public.inventory_product_sale_schedules
  where product_id = p_product_id
    and workspace_id = p_workspace_id;

  for v_schedule in
    select *
    from jsonb_to_recordset(v_schedules) as schedule(
      store_id uuid,
      name text,
      sale_month integer,
      sale_day integer
    )
  loop
    v_schedule.name := btrim(coalesce(v_schedule.name, ''));

    if v_schedule.store_id is null then
      raise exception using errcode = '22023',
        message = '정기 세일 일정의 쇼핑몰을 선택해주세요.';
    end if;
    if v_schedule.name = '' then
      raise exception using errcode = '22023',
        message = '정기 세일 일정의 행사명을 입력해주세요.';
    end if;
    if v_schedule.sale_month is null
       or v_schedule.sale_month not between 1 and 12 then
      raise exception using errcode = '22023',
        message = '정기 세일 일정의 월은 1~12 사이여야 합니다.';
    end if;

    v_max_day := case
      when v_schedule.sale_month = 2 then 29
      when v_schedule.sale_month in (4, 6, 9, 11) then 30
      else 31
    end;
    if v_schedule.sale_day is null
       or v_schedule.sale_day not between 1 and v_max_day then
      raise exception using errcode = '22023',
        message = '정기 세일 일정의 날짜를 확인해주세요.';
    end if;

    if not exists (
      select 1
      from public.inventory_product_stores as product_store
      join public.inventory_stores as store
        on store.id = product_store.store_id
       and store.workspace_id = product_store.workspace_id
      where product_store.product_id = p_product_id
        and product_store.workspace_id = p_workspace_id
        and product_store.store_id = v_schedule.store_id
        and store.is_active = true
    ) then
      raise exception using errcode = '23503',
        message = '제품에 연결된 쇼핑몰만 정기 세일 일정에 사용할 수 있습니다.';
    end if;

    insert into public.inventory_product_sale_schedules (
      workspace_id,
      product_id,
      store_id,
      name,
      sale_month,
      sale_day,
      created_by,
      updated_by
    )
    values (
      p_workspace_id,
      p_product_id,
      v_schedule.store_id,
      v_schedule.name,
      v_schedule.sale_month,
      v_schedule.sale_day,
      p_user_id,
      p_user_id
    );
  end loop;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = '같은 정기 세일 일정이 중복되어 있습니다.';
end;
$$;

comment on function private.replace_inventory_product_sale_schedules(
  uuid, uuid, jsonb, uuid
) is
  '제품 설정 저장 트랜잭션 안에서 검증된 정기 세일 일정 전체를 교체합니다.';

revoke all on function private.replace_inventory_product_sale_schedules(
  uuid, uuid, jsonb, uuid
) from public, anon, authenticated;

create function public.create_inventory_product_with_schedules(
  p_workspace_id uuid,
  p_name text,
  p_usage_tracking text default 'decrement',
  p_unit_label text default '개',
  p_low_stock_threshold numeric default 1,
  p_alert_days integer default 30,
  p_package_size numeric default null,
  p_capacity_unit text default null,
  p_notes text default null,
  p_store_ids uuid[] default '{}'::uuid[],
  p_category text default '미분류',
  p_purchase_safety_quantity integer default 0,
  p_sale_schedules jsonb default '[]'::jsonb
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
  v_tracking_mode text;
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
  if p_usage_tracking not in ('decrement', 'cycle') then
    raise exception using errcode = '22023',
      message = '기본 사용 기록 방식을 확인해주세요.';
  end if;
  if v_unit_label = '' then
    raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
  end if;
  if coalesce(p_low_stock_threshold, 0) < 0 then
    raise exception using errcode = '22023',
      message = '재고 알림 수량은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023',
      message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;
  if coalesce(p_purchase_safety_quantity, 0) < 0
     or coalesce(p_purchase_safety_quantity, 0)
       <> trunc(coalesce(p_purchase_safety_quantity, 0)) then
    raise exception using errcode = '22023',
      message = '여유 재고는 0 이상의 정수여야 합니다.';
  end if;
  if (p_package_size is null) <> (v_capacity_unit is null) then
    raise exception using errcode = '22023',
      message = '제품 용량과 용량 단위를 함께 입력해주세요.';
  end if;
  if p_package_size is not null and p_package_size <= 0 then
    raise exception using errcode = '22023',
      message = '제품 용량은 0보다 커야 합니다.';
  end if;
  if p_usage_tracking = 'cycle'
     and coalesce(p_low_stock_threshold, 0)
       <> trunc(coalesce(p_low_stock_threshold, 0)) then
    raise exception using errcode = '22023',
      message = '개봉-소진 주기 방식의 재고 알림 수량은 정수여야 합니다.';
  end if;
  if exists (
    select 1
    from public.inventory_products as product
    where product.workspace_id = p_workspace_id
      and lower(product.name) = lower(v_name)
      and product.is_archived = false
  ) then
    raise exception using errcode = '23505',
      message = '같은 이름의 제품이 이미 있습니다.';
  end if;

  v_tracking_mode := case p_usage_tracking
    when 'cycle' then 'cycle'
    else 'count'
  end;

  insert into public.inventory_products (
    workspace_id,
    name,
    category,
    tracking_mode,
    usage_tracking,
    unit_label,
    package_size,
    capacity_unit,
    current_quantity,
    stock_initialized,
    low_stock_threshold,
    alert_days,
    current_consumer_count,
    purchase_safety_quantity,
    active_months,
    next_sale_on,
    purchase_coverage_months,
    notes,
    created_by,
    updated_by
  )
  values (
    p_workspace_id,
    v_name,
    v_category,
    v_tracking_mode,
    p_usage_tracking,
    v_unit_label,
    p_package_size,
    v_capacity_unit,
    0,
    false,
    coalesce(p_low_stock_threshold, 0),
    coalesce(p_alert_days, 30),
    1,
    coalesce(p_purchase_safety_quantity, 0),
    null,
    null,
    null,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_user_id,
    v_user_id
  )
  returning * into v_product;

  perform private.replace_inventory_product_stores(
    v_product.id,
    v_product.workspace_id,
    p_store_ids,
    v_user_id
  );
  perform private.replace_inventory_product_sale_schedules(
    v_product.id,
    v_product.workspace_id,
    p_sale_schedules,
    v_user_id
  );

  select *
  into v_product
  from public.inventory_products
  where id = v_product.id;

  return v_product;
end;
$$;

comment on function public.create_inventory_product_with_schedules(
  uuid, text, text, text, numeric, integer, numeric, text, text, uuid[],
  text, integer, jsonb
) is
  '관찰 모델의 제품, 복수 쇼핑몰과 정기 세일 일정을 한 트랜잭션에서 생성합니다.';

revoke all on function public.create_inventory_product_with_schedules(
  uuid, text, text, text, numeric, integer, numeric, text, text, uuid[],
  text, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.create_inventory_product_with_schedules(
  uuid, text, text, text, numeric, integer, numeric, text, text, uuid[],
  text, integer, jsonb
) to authenticated;

create function public.update_inventory_product_with_schedules(
  p_product_id uuid,
  p_name text,
  p_usage_tracking text,
  p_unit_label text,
  p_low_stock_threshold numeric,
  p_alert_days integer,
  p_package_size numeric,
  p_capacity_unit text,
  p_notes text,
  p_store_ids uuid[],
  p_category text,
  p_purchase_safety_quantity integer,
  p_sale_schedules jsonb
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
  v_tracking_mode text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
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
  if v_name = '' then
    raise exception using errcode = '22023', message = '제품명을 입력해주세요.';
  end if;
  if v_category not in ('식료품', '화장품', '생활용품', '영양제', '의복', '미분류') then
    raise exception using errcode = '22023', message = '카테고리를 확인해주세요.';
  end if;
  if p_usage_tracking not in ('decrement', 'cycle') then
    raise exception using errcode = '22023',
      message = '기본 사용 기록 방식을 확인해주세요.';
  end if;
  if v_unit_label = '' then
    raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
  end if;
  if coalesce(p_low_stock_threshold, 0) < 0 then
    raise exception using errcode = '22023',
      message = '재고 알림 수량은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023',
      message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;
  if coalesce(p_purchase_safety_quantity, 0) < 0
     or coalesce(p_purchase_safety_quantity, 0)
       <> trunc(coalesce(p_purchase_safety_quantity, 0)) then
    raise exception using errcode = '22023',
      message = '여유 재고는 0 이상의 정수여야 합니다.';
  end if;
  if (p_package_size is null) <> (v_capacity_unit is null) then
    raise exception using errcode = '22023',
      message = '제품 용량과 용량 단위를 함께 입력해주세요.';
  end if;
  if p_package_size is not null and p_package_size <= 0 then
    raise exception using errcode = '22023',
      message = '제품 용량은 0보다 커야 합니다.';
  end if;

  if p_usage_tracking is distinct from v_product.usage_tracking
     and v_product.active_opened_on is not null then
    raise exception using errcode = '22023',
      message = '사용 중인 제품을 다 쓴 뒤 기본 사용 기록 방식을 바꿔주세요.';
  end if;
  if p_usage_tracking = 'cycle' then
    if v_product.current_quantity <> trunc(v_product.current_quantity) then
      raise exception using errcode = '22023',
        message = '현재 재고가 정수일 때만 개봉-소진 주기 방식으로 바꿀 수 있습니다.';
    end if;
    if coalesce(p_low_stock_threshold, 0)
       <> trunc(coalesce(p_low_stock_threshold, 0)) then
      raise exception using errcode = '22023',
        message = '개봉-소진 주기 방식의 재고 알림 수량은 정수여야 합니다.';
    end if;
  end if;

  v_tracking_mode := case p_usage_tracking
    when 'cycle' then 'cycle'
    else 'count'
  end;

  update public.inventory_products
  set
    name = v_name,
    category = v_category,
    tracking_mode = v_tracking_mode,
    usage_tracking = p_usage_tracking,
    unit_label = v_unit_label,
    package_size = p_package_size,
    capacity_unit = v_capacity_unit,
    low_stock_threshold = coalesce(p_low_stock_threshold, 0),
    alert_days = coalesce(p_alert_days, 30),
    purchase_safety_quantity = coalesce(p_purchase_safety_quantity, 0),
    notes = nullif(btrim(coalesce(p_notes, '')), ''),
    updated_by = v_user_id
  where id = v_product.id
  returning * into v_product;

  perform private.replace_inventory_product_stores(
    v_product.id,
    v_product.workspace_id,
    p_store_ids,
    v_user_id
  );
  perform private.replace_inventory_product_sale_schedules(
    v_product.id,
    v_product.workspace_id,
    p_sale_schedules,
    v_user_id
  );

  select *
  into v_product
  from public.inventory_products
  where id = v_product.id;

  return v_product;
end;
$$;

comment on function public.update_inventory_product_with_schedules(
  uuid, text, text, text, numeric, integer, numeric, text, text, uuid[],
  text, integer, jsonb
) is
  '관찰 모델의 제품, 기본 사용 기록 방식, 복수 쇼핑몰과 정기 세일 일정을 한 트랜잭션에서 수정합니다.';

revoke all on function public.update_inventory_product_with_schedules(
  uuid, text, text, text, numeric, integer, numeric, text, text, uuid[],
  text, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.update_inventory_product_with_schedules(
  uuid, text, text, text, numeric, integer, numeric, text, text, uuid[],
  text, integer, jsonb
) to authenticated;

create function public.upsert_inventory_consumption_baseline(
  p_product_id uuid,
  p_started_on date,
  p_ended_on date,
  p_consumed_quantity numeric default null,
  p_consumer_count integer default 1,
  p_note text default null
)
returns public.inventory_consumption_baselines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_baseline public.inventory_consumption_baselines%rowtype;
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_consumed_quantity numeric;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
    and is_archived = false;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;
  if p_started_on is null or p_ended_on is null then
    raise exception using errcode = '22023',
      message = '대략적인 시작일과 종료일을 모두 입력해주세요.';
  end if;
  if p_ended_on < p_started_on then
    raise exception using errcode = '22023',
      message = '종료일은 시작일보다 빠를 수 없습니다.';
  end if;
  if p_started_on > v_today or p_ended_on > v_today then
    raise exception using errcode = '22023',
      message = '회상 소비 기준에는 오늘 또는 과거 날짜만 사용할 수 있습니다.';
  end if;
  if coalesce(p_consumer_count, 0) < 1 then
    raise exception using errcode = '22023',
      message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  v_consumed_quantity := case v_product.usage_tracking
    when 'cycle' then 1
    else p_consumed_quantity
  end;
  if v_consumed_quantity is null or v_consumed_quantity <= 0 then
    raise exception using errcode = '22023',
      message = '해당 기간에 사용한 총수량을 입력해주세요.';
  end if;

  insert into public.inventory_consumption_baselines (
    workspace_id,
    product_id,
    usage_tracking,
    started_on,
    ended_on,
    consumed_quantity,
    quantity_unit,
    package_size,
    capacity_unit,
    consumer_count,
    note,
    created_by,
    updated_by
  )
  values (
    v_product.workspace_id,
    v_product.id,
    v_product.usage_tracking,
    p_started_on,
    p_ended_on,
    v_consumed_quantity,
    v_product.unit_label,
    v_product.package_size,
    v_product.capacity_unit,
    p_consumer_count,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_user_id,
    v_user_id
  )
  on conflict (product_id) do update
  set
    usage_tracking = excluded.usage_tracking,
    started_on = excluded.started_on,
    ended_on = excluded.ended_on,
    consumed_quantity = excluded.consumed_quantity,
    quantity_unit = excluded.quantity_unit,
    package_size = excluded.package_size,
    capacity_unit = excluded.capacity_unit,
    consumer_count = excluded.consumer_count,
    note = excluded.note,
    updated_by = excluded.updated_by
  returning * into v_baseline;

  return v_baseline;
end;
$$;

comment on function public.upsert_inventory_consumption_baseline(
  uuid, date, date, numeric, integer, text
) is
  '실제 사용 기록 전 임시 예측에만 쓰는 제품별 회상 소비 기준을 저장합니다.';

revoke all on function public.upsert_inventory_consumption_baseline(
  uuid, date, date, numeric, integer, text
) from public, anon, authenticated;

grant execute on function public.upsert_inventory_consumption_baseline(
  uuid, date, date, numeric, integer, text
) to authenticated;

create function public.delete_inventory_consumption_baseline(
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  select workspace_id
  into v_workspace_id
  from public.inventory_products
  where id = p_product_id;

  if v_workspace_id is null
     or not private.is_workspace_member(v_workspace_id) then
    raise exception using errcode = '42501',
      message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;

  delete from public.inventory_consumption_baselines
  where product_id = p_product_id
    and workspace_id = v_workspace_id;
end;
$$;

comment on function public.delete_inventory_consumption_baseline(uuid) is
  '제품별 회상 소비 기준을 삭제합니다.';

revoke all on function public.delete_inventory_consumption_baseline(uuid)
from public, anon, authenticated;

grant execute on function public.delete_inventory_consumption_baseline(uuid)
to authenticated;

notify pgrst, 'reload schema';
