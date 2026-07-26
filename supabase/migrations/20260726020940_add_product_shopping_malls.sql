-- A product can be available from multiple shopping malls while each purchase
-- still records the single mall that fulfilled that order.

create table public.inventory_product_stores (
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  product_id uuid not null,
  store_id uuid not null,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_product_stores_pkey
    primary key (product_id, store_id),
  constraint inventory_product_stores_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id) on delete cascade,
  constraint inventory_product_stores_store_workspace_fk
    foreign key (store_id, workspace_id)
    references public.inventory_stores(id, workspace_id) on delete restrict
);

create index inventory_product_stores_workspace_index
  on public.inventory_product_stores (workspace_id);

create index inventory_product_stores_store_workspace_index
  on public.inventory_product_stores (store_id, workspace_id);

insert into public.inventory_product_stores (
  workspace_id,
  product_id,
  store_id,
  created_by
)
select
  product.workspace_id,
  product.id,
  product.preferred_store_id,
  product.updated_by
from public.inventory_products as product
where product.preferred_store_id is not null
on conflict (product_id, store_id) do nothing;

alter table public.inventory_product_stores enable row level security;

revoke all on table public.inventory_product_stores
from public, anon, authenticated;

grant select on table public.inventory_product_stores
to authenticated;

create policy inventory_product_stores_select_member
on public.inventory_product_stores
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create function private.replace_inventory_product_stores(
  p_product_id uuid,
  p_workspace_id uuid,
  p_store_ids uuid[],
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_store_ids uuid[];
begin
  select coalesce(
    array_agg(normalized.store_id order by normalized.first_position),
    '{}'::uuid[]
  )
  into v_store_ids
  from (
    select selected.store_id, min(selected.position) as first_position
    from unnest(coalesce(p_store_ids, '{}'::uuid[]))
      with ordinality as selected(store_id, position)
    where selected.store_id is not null
    group by selected.store_id
  ) as normalized;

  if exists (
    select 1
    from unnest(v_store_ids) as selected(store_id)
    left join public.inventory_stores as store
      on store.id = selected.store_id
      and store.workspace_id = p_workspace_id
      and store.is_active = true
    where store.id is null
  ) then
    raise exception using errcode = '23503',
      message = '선택한 쇼핑몰을 확인할 수 없습니다.';
  end if;

  delete from public.inventory_product_stores
  where product_id = p_product_id
    and workspace_id = p_workspace_id
    and not (store_id = any(v_store_ids));

  insert into public.inventory_product_stores (
    workspace_id,
    product_id,
    store_id,
    created_by
  )
  select
    p_workspace_id,
    p_product_id,
    selected.store_id,
    p_user_id
  from unnest(v_store_ids) as selected(store_id)
  on conflict (product_id, store_id) do nothing;

  update public.inventory_products
  set
    preferred_store_id = v_store_ids[1],
    updated_by = p_user_id
  where id = p_product_id
    and workspace_id = p_workspace_id;
end;
$$;

revoke all on function private.replace_inventory_product_stores(
  uuid,
  uuid,
  uuid[],
  uuid
) from public, anon, authenticated;

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
begin
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
) is
  '제품 기준 정보와 복수 쇼핑몰 연결을 한 트랜잭션에서 생성합니다.';

revoke all on function public.create_inventory_product_with_stores(
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
) from public, anon;

grant execute on function public.create_inventory_product_with_stores(
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
  p_category text
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
    raise exception using errcode = '22023',
      message = '구매 기준은 0 이상이어야 합니다.';
  end if;
  if coalesce(p_alert_days, 0) < 1 then
    raise exception using errcode = '22023',
      message = '구매 알림 기준일은 1일 이상이어야 합니다.';
  end if;

  if v_product.tracking_mode = 'cycle' then
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
) is
  '제품 기준 정보와 복수 쇼핑몰 연결을 한 트랜잭션에서 수정합니다.';

revoke all on function public.update_inventory_product_with_stores(
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
) from public, anon;

grant execute on function public.update_inventory_product_with_stores(
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
) to authenticated;

comment on table public.inventory_product_stores is
  '제품별로 선택한 복수 쇼핑몰 연결.';

notify pgrst, 'reload schema';
