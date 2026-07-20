-- Purchase Log v1
-- 구매 기록은 현재 재고와 분리하며, 제품의 주구매처와 과거 구매 간격을 저장합니다.

create table if not exists public.inventory_stores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint inventory_stores_name_not_blank
    check (btrim(name) <> ''),
  constraint inventory_stores_name_trimmed
    check (name = btrim(name)),
  constraint inventory_stores_sort_order_nonnegative
    check (sort_order >= 0),
  constraint inventory_stores_workspace_name_unique
    unique (workspace_id, name),
  constraint inventory_stores_id_workspace_unique
    unique (id, workspace_id)
);

insert into public.inventory_stores (workspace_id, name, sort_order, created_by)
values
  ('00000000-0000-0000-0000-000000000002'::uuid, '쿠팡', 10, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '네이버', 20, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '마켓컬리', 30, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '아이허브', 40, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '올리브영', 50, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '자사몰', 60, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '기타', 999, null)
on conflict (workspace_id, name)
do update set
  sort_order = excluded.sort_order,
  is_active = true;

alter table public.inventory_products
  add column if not exists preferred_store_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_products_preferred_store_workspace_fk'
      and conrelid = 'public.inventory_products'::regclass
  ) then
    alter table public.inventory_products
      add constraint inventory_products_preferred_store_workspace_fk
      foreign key (preferred_store_id, workspace_id)
      references public.inventory_stores(id, workspace_id)
      on delete restrict;
  end if;
end
$$;

create table if not exists public.inventory_purchases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  product_id uuid not null,
  store_id uuid not null,
  purchased_on date not null,
  package_count integer not null default 1,
  package_size numeric(12, 3) null,
  package_unit text null,
  total_price numeric(14, 2) null,
  shipping_fee numeric(14, 2) null,
  note text null,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  updated_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_purchases_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id)
    on delete cascade,
  constraint inventory_purchases_store_workspace_fk
    foreign key (store_id, workspace_id)
    references public.inventory_stores(id, workspace_id)
    on delete restrict,
  constraint inventory_purchases_package_count_positive
    check (package_count >= 1),
  constraint inventory_purchases_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_purchases_package_unit_pair
    check (
      (package_size is null and package_unit is null)
      or
      (package_size is not null and package_unit is not null and btrim(package_unit) <> '')
    ),
  constraint inventory_purchases_package_unit_trimmed
    check (package_unit is null or package_unit = btrim(package_unit)),
  constraint inventory_purchases_total_price_nonnegative
    check (total_price is null or total_price >= 0),
  constraint inventory_purchases_shipping_fee_nonnegative
    check (shipping_fee is null or shipping_fee >= 0)
);

create index if not exists inventory_stores_created_by_index
  on public.inventory_stores (created_by);

create index if not exists inventory_products_preferred_store_workspace_index
  on public.inventory_products (preferred_store_id, workspace_id)
  where preferred_store_id is not null;

create index if not exists inventory_purchases_workspace_date_index
  on public.inventory_purchases (workspace_id, purchased_on desc);

create index if not exists inventory_purchases_product_workspace_date_index
  on public.inventory_purchases (product_id, workspace_id, purchased_on desc);

create index if not exists inventory_purchases_store_workspace_date_index
  on public.inventory_purchases (store_id, workspace_id, purchased_on desc);

create index if not exists inventory_purchases_created_by_index
  on public.inventory_purchases (created_by);

create index if not exists inventory_purchases_updated_by_index
  on public.inventory_purchases (updated_by);

create or replace function private.set_inventory_purchase_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_inventory_purchase_updated_at()
from public, anon, authenticated;

drop trigger if exists inventory_purchases_set_updated_at
on public.inventory_purchases;

create trigger inventory_purchases_set_updated_at
before update on public.inventory_purchases
for each row execute function private.set_inventory_purchase_updated_at();

alter table public.inventory_stores enable row level security;
alter table public.inventory_purchases enable row level security;

revoke all on table public.inventory_stores
from public, anon, authenticated;
revoke all on table public.inventory_purchases
from public, anon, authenticated;

grant select on table public.inventory_stores
to authenticated;
grant select, insert, update, delete on table public.inventory_purchases
to authenticated;

drop policy if exists inventory_stores_select_member
on public.inventory_stores;

create policy inventory_stores_select_member
on public.inventory_stores
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists inventory_purchases_select_member
on public.inventory_purchases;

create policy inventory_purchases_select_member
on public.inventory_purchases
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists inventory_purchases_insert_member
on public.inventory_purchases;

create policy inventory_purchases_insert_member
on public.inventory_purchases
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists inventory_purchases_update_member
on public.inventory_purchases;

create policy inventory_purchases_update_member
on public.inventory_purchases
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check (
  (select private.is_workspace_member(workspace_id))
  and updated_by = (select auth.uid())
);

drop policy if exists inventory_purchases_delete_member
on public.inventory_purchases;

create policy inventory_purchases_delete_member
on public.inventory_purchases
for delete
to authenticated
using ((select private.is_workspace_member(workspace_id)));

-- 기존 함수와 같은 호출을 유지하면서 주구매처 인자를 마지막에 추가합니다.
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
  date
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
  if p_tracking_mode not in ('count', 'cycle') then
    raise exception using errcode = '22023', message = '재고 기준이 올바르지 않습니다.';
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
    if v_capacity_unit is null then
      raise exception using errcode = '22023', message = '용량 단위를 입력해주세요.';
    end if;
    if p_package_size is null or p_package_size <= 0 then
      raise exception using errcode = '22023', message = '새 제품 1개의 전체 용량을 입력해주세요.';
    end if;
    if coalesce(p_current_consumer_count, 0) < 1 then
      raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
    end if;
    v_unit_label := v_capacity_unit;
  else
    if v_unit_label = '' then
      raise exception using errcode = '22023', message = '재고 단위를 입력해주세요.';
    end if;
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

comment on table public.inventory_stores is
  'Inventory Tracker의 선택 가능한 구매처 목록.';
comment on table public.inventory_purchases is
  '재고 증감과 분리된 과거 및 현재 구매 기록.';

notify pgrst, 'reload schema';
