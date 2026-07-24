-- Inventory Tracker v2 baseline
--
-- This migration intentionally rebuilds only the inventory-tracker objects.
-- It must be applied together with the matching frontend release, after an
-- inventory-only JSON/SQL backup and explicit production approval.
--
-- Shared project objects (auth, workspaces, workspace_members and the private
-- membership helper) are prerequisites and are never dropped here.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;

do $$
begin
  if to_regclass('public.workspaces') is null then
    raise exception 'Inventory Tracker requires the shared public.workspaces table.';
  end if;

  if to_regprocedure('private.is_workspace_member(uuid)') is null then
    raise exception 'Inventory Tracker requires private.is_workspace_member(uuid).';
  end if;
end
$$;

insert into public.workspaces (id, name)
values ('00000000-0000-0000-0000-000000000002'::uuid, 'inventory-tracker')
on conflict (id) do update set name = excluded.name;

-- Drop functions before their table-backed return types.
drop function if exists public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date
);
drop function if exists public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid
);
drop function if exists public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid, text
);
drop function if exists public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
);
drop function if exists public.update_active_usage(uuid, date, integer);
drop function if exists public.set_inventory_product_archived(uuid, boolean);
drop function if exists public.delete_unused_inventory_product(uuid);

drop table if exists public.inventory_events;
drop table if exists public.inventory_usage_cycles;
drop table if exists public.inventory_purchases;
drop table if exists public.inventory_products;
drop table if exists public.inventory_stores;

drop function if exists private.set_inventory_product_updated_at();
drop function if exists private.set_inventory_purchase_updated_at();
drop function if exists private.set_usage_cycle_duration();

create table public.inventory_stores (
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

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  name text not null,
  category text not null default '미분류',
  tracking_mode text not null default 'count',
  unit_label text not null default '개',
  package_size numeric(12, 3) null,
  capacity_unit text null,
  current_quantity numeric(12, 3) not null default 0,
  stock_initialized boolean not null default false,
  low_stock_threshold numeric(12, 3) not null default 1,
  alert_days integer not null default 30,
  current_consumer_count integer not null default 1,
  active_opened_on date null,
  active_consumer_count integer null,
  preferred_store_id uuid null,
  notes text null,
  is_archived boolean not null default false,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  updated_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_products_name_not_blank
    check (btrim(name) <> ''),
  constraint inventory_products_name_trimmed
    check (name = btrim(name)),
  constraint inventory_products_category_allowed
    check (category in ('식료품', '화장품', '생활용품', '영양제', '의복', '미분류')),
  constraint inventory_products_tracking_mode_allowed
    check (tracking_mode in ('count', 'cycle')),
  constraint inventory_products_unit_label_not_blank
    check (btrim(unit_label) <> ''),
  constraint inventory_products_unit_label_trimmed
    check (unit_label = btrim(unit_label)),
  constraint inventory_products_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_products_capacity_unit_pair
    check (
      (package_size is null and capacity_unit is null)
      or (
        package_size is not null
        and capacity_unit is not null
        and btrim(capacity_unit) <> ''
        and capacity_unit = btrim(capacity_unit)
      )
    ),
  constraint inventory_products_cycle_package_required
    check (
      tracking_mode <> 'cycle'
      or (package_size is not null and capacity_unit is not null)
    ),
  constraint inventory_products_count_package_empty
    check (
      tracking_mode <> 'count'
      or (package_size is null and capacity_unit is null)
    ),
  constraint inventory_products_quantity_nonnegative
    check (current_quantity >= 0),
  constraint inventory_products_cycle_quantity_whole
    check (tracking_mode <> 'cycle' or current_quantity = trunc(current_quantity)),
  constraint inventory_products_threshold_nonnegative
    check (low_stock_threshold >= 0),
  constraint inventory_products_cycle_threshold_whole
    check (
      tracking_mode <> 'cycle'
      or low_stock_threshold = trunc(low_stock_threshold)
    ),
  constraint inventory_products_alert_days_positive
    check (alert_days >= 1),
  constraint inventory_products_consumer_count_positive
    check (current_consumer_count >= 1),
  constraint inventory_products_active_consumer_count_positive
    check (active_consumer_count is null or active_consumer_count >= 1),
  constraint inventory_products_active_cycle_only
    check (
      (active_opened_on is null and active_consumer_count is null)
      or (
        tracking_mode = 'cycle'
        and active_opened_on is not null
        and active_consumer_count is not null
        and stock_initialized
        and current_quantity >= 1
      )
    ),
  constraint inventory_products_preferred_store_workspace_fk
    foreign key (preferred_store_id, workspace_id)
    references public.inventory_stores(id, workspace_id) on delete restrict,
  constraint inventory_products_id_workspace_unique
    unique (id, workspace_id)
);

create unique index inventory_products_workspace_name_unique
  on public.inventory_products (workspace_id, lower(name))
  where is_archived = false;

create index inventory_products_workspace_index
  on public.inventory_products (workspace_id, is_archived, name);

create index inventory_products_preferred_store_index
  on public.inventory_products (preferred_store_id, workspace_id)
  where preferred_store_id is not null;

create table public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  product_id uuid not null,
  event_type text not null,
  quantity_delta numeric(12, 3) not null default 0,
  quantity_before numeric(12, 3) not null,
  quantity_after numeric(12, 3) not null,
  occurred_on date not null default current_date,
  consumer_count integer null,
  note text null,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint inventory_events_type_allowed
    check (event_type in ('intake', 'use', 'open', 'finish', 'adjustment')),
  constraint inventory_events_quantities_nonnegative
    check (quantity_before >= 0 and quantity_after >= 0),
  constraint inventory_events_delta_matches
    check (quantity_after = quantity_before + quantity_delta),
  constraint inventory_events_open_delta_zero
    check (event_type <> 'open' or quantity_delta = 0),
  constraint inventory_events_finish_delta_one
    check (event_type <> 'finish' or quantity_delta = -1),
  constraint inventory_events_consumer_count_positive
    check (consumer_count is null or consumer_count >= 1),
  constraint inventory_events_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id) on delete restrict
);

create index inventory_events_product_date_index
  on public.inventory_events (product_id, occurred_on desc, created_at desc);

create index inventory_events_workspace_date_index
  on public.inventory_events (workspace_id, occurred_on desc, created_at desc);

create table public.inventory_usage_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  product_id uuid not null,
  opened_on date not null,
  finished_on date not null,
  duration_days integer not null,
  package_size numeric(12, 3) null,
  capacity_unit text null,
  consumer_count integer not null,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint inventory_usage_cycles_dates_valid
    check (finished_on >= opened_on),
  constraint inventory_usage_cycles_duration_exact
    check (duration_days = (finished_on - opened_on) + 1),
  constraint inventory_usage_cycles_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_usage_cycles_capacity_unit_pair
    check (
      (package_size is null and capacity_unit is null)
      or (
        package_size is not null
        and capacity_unit is not null
        and btrim(capacity_unit) <> ''
      )
    ),
  constraint inventory_usage_cycles_consumer_count_positive
    check (consumer_count >= 1),
  constraint inventory_usage_cycles_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id) on delete restrict,
  constraint inventory_usage_cycles_product_dates_unique
    unique (product_id, opened_on, finished_on)
);

create index inventory_usage_cycles_product_date_index
  on public.inventory_usage_cycles (product_id, finished_on desc, created_at desc);

create index inventory_usage_cycles_workspace_index
  on public.inventory_usage_cycles (workspace_id, finished_on desc);

create table public.inventory_purchases (
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
    references public.inventory_products(id, workspace_id) on delete restrict,
  constraint inventory_purchases_store_workspace_fk
    foreign key (store_id, workspace_id)
    references public.inventory_stores(id, workspace_id) on delete restrict,
  constraint inventory_purchases_package_count_positive
    check (package_count >= 1),
  constraint inventory_purchases_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_purchases_package_unit_pair
    check (
      (package_size is null and package_unit is null)
      or (
        package_size is not null
        and package_unit is not null
        and btrim(package_unit) <> ''
      )
    ),
  constraint inventory_purchases_package_unit_trimmed
    check (package_unit is null or package_unit = btrim(package_unit)),
  constraint inventory_purchases_total_price_nonnegative
    check (total_price is null or total_price >= 0),
  constraint inventory_purchases_shipping_fee_nonnegative
    check (shipping_fee is null or shipping_fee >= 0)
);

create index inventory_purchases_workspace_date_index
  on public.inventory_purchases (workspace_id, purchased_on desc);

create index inventory_purchases_product_date_index
  on public.inventory_purchases (product_id, purchased_on desc);

create index inventory_purchases_store_date_index
  on public.inventory_purchases (store_id, purchased_on desc);

insert into public.inventory_stores (workspace_id, name, sort_order, created_by)
values
  ('00000000-0000-0000-0000-000000000002'::uuid, '쿠팡', 10, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '네이버', 20, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '마켓컬리', 30, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '아이허브', 40, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '올리브영', 50, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '자사몰', 60, null),
  ('00000000-0000-0000-0000-000000000002'::uuid, '기타', 999, null);

create function private.set_inventory_product_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger inventory_products_set_updated_at
before update on public.inventory_products
for each row execute function private.set_inventory_product_updated_at();

create function private.set_inventory_purchase_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger inventory_purchases_set_updated_at
before update on public.inventory_purchases
for each row execute function private.set_inventory_purchase_updated_at();

create function private.set_usage_cycle_duration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.opened_on is null or new.finished_on is null then
    raise exception using errcode = '22023',
      message = '개봉일과 다 쓴 날을 모두 입력해주세요.';
  end if;
  if new.finished_on < new.opened_on then
    raise exception using errcode = '22023',
      message = '다 쓴 날은 개봉일보다 빠를 수 없습니다.';
  end if;
  if new.finished_on > current_date then
    raise exception using errcode = '22023',
      message = '미래 날짜는 사용 주기로 저장할 수 없습니다.';
  end if;
  if coalesce(new.consumer_count, 0) < 1 then
    raise exception using errcode = '22023',
      message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  new.duration_days := (new.finished_on - new.opened_on) + 1;
  return new;
end;
$$;

create trigger inventory_usage_cycles_set_duration
before insert or update of opened_on, finished_on, consumer_count
on public.inventory_usage_cycles
for each row execute function private.set_usage_cycle_duration();

revoke all on function private.set_inventory_product_updated_at()
from public, anon, authenticated;
revoke all on function private.set_inventory_purchase_updated_at()
from public, anon, authenticated;
revoke all on function private.set_usage_cycle_duration()
from public, anon, authenticated;

alter table public.inventory_stores enable row level security;
alter table public.inventory_products enable row level security;
alter table public.inventory_events enable row level security;
alter table public.inventory_usage_cycles enable row level security;
alter table public.inventory_purchases enable row level security;

revoke all on table public.inventory_stores
from public, anon, authenticated;
revoke all on table public.inventory_products
from public, anon, authenticated;
revoke all on table public.inventory_events
from public, anon, authenticated;
revoke all on table public.inventory_usage_cycles
from public, anon, authenticated;
revoke all on table public.inventory_purchases
from public, anon, authenticated;

grant select on table public.inventory_stores
to authenticated;
grant select on table public.inventory_products
to authenticated;
grant update (
  name,
  category,
  unit_label,
  package_size,
  capacity_unit,
  low_stock_threshold,
  alert_days,
  current_consumer_count,
  preferred_store_id,
  notes,
  updated_by
) on table public.inventory_products
to authenticated;
grant select on table public.inventory_events
to authenticated;
grant select on table public.inventory_usage_cycles
to authenticated;
grant update (opened_on, finished_on, consumer_count), delete
on table public.inventory_usage_cycles
to authenticated;
grant select, insert, update, delete on table public.inventory_purchases
to authenticated;

create policy inventory_stores_select_member
on public.inventory_stores
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_products_select_member
on public.inventory_products
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_products_update_member
on public.inventory_products
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check (
  (select private.is_workspace_member(workspace_id))
  and updated_by = (select auth.uid())
);

create policy inventory_events_select_member
on public.inventory_events
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_usage_cycles_select_member
on public.inventory_usage_cycles
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_usage_cycles_update_member
on public.inventory_usage_cycles
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy inventory_usage_cycles_delete_member
on public.inventory_usage_cycles
for delete
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_purchases_select_member
on public.inventory_purchases
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_purchases_insert_member
on public.inventory_purchases
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

create policy inventory_purchases_update_member
on public.inventory_purchases
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check (
  (select private.is_workspace_member(workspace_id))
  and updated_by = (select auth.uid())
);

create policy inventory_purchases_delete_member
on public.inventory_purchases
for delete
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create function public.create_inventory_product(
  p_workspace_id uuid,
  p_name text,
  p_tracking_mode text default 'count',
  p_unit_label text default '개',
  p_initial_quantity numeric default null,
  p_low_stock_threshold numeric default 1,
  p_alert_days integer default 30,
  p_package_size numeric default null,
  p_capacity_unit text default null,
  p_current_consumer_count integer default 1,
  p_notes text default null,
  p_occurred_on date default current_date,
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
  if p_occurred_on is null or p_occurred_on > current_date then
    raise exception using errcode = '22023',
      message = '기록 날짜는 오늘 또는 과거 날짜여야 합니다.';
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
  if p_initial_quantity is not null and p_initial_quantity < 0 then
    raise exception using errcode = '22023',
      message = '현재 재고는 0 이상이어야 합니다.';
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
    if p_initial_quantity is not null
       and p_initial_quantity <> trunc(p_initial_quantity) then
      raise exception using errcode = '22023',
        message = '개봉·소진 제품의 현재 재고는 정수 개수로 입력해주세요.';
    end if;
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
    coalesce(p_initial_quantity, 0),
    p_initial_quantity is not null,
    coalesce(p_low_stock_threshold, 0),
    coalesce(p_alert_days, 30),
    coalesce(p_current_consumer_count, 1),
    p_preferred_store_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_user_id,
    v_user_id
  )
  returning * into v_product;

  if p_initial_quantity is not null then
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
      v_user_id
    );
  end if;

  return v_product;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = '같은 이름의 제품이 이미 있습니다.';
end;
$$;

create function public.record_inventory_action(
  p_product_id uuid,
  p_action text,
  p_amount numeric default null,
  p_target_quantity numeric default null,
  p_occurred_on date default current_date,
  p_consumer_count integer default null,
  p_note text default null
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_before numeric(12, 3);
  v_after numeric(12, 3);
  v_delta numeric(12, 3) := 0;
  v_event_consumer_count integer := null;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_was_initialized boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_action not in ('intake', 'use', 'open', 'finish', 'adjustment') then
    raise exception using errcode = '22023',
      message = '지원하지 않는 재고 기록입니다.';
  end if;
  if p_occurred_on is null or p_occurred_on > current_date then
    raise exception using errcode = '22023',
      message = '기록 날짜는 오늘 또는 과거 날짜여야 합니다.';
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

  v_was_initialized := v_product.stock_initialized;
  if not v_was_initialized and p_action not in ('intake', 'adjustment') then
    raise exception using errcode = '22023',
      message = '먼저 첫 입고를 기록하거나 현재 재고를 설정해주세요.';
  end if;

  v_before := v_product.current_quantity;
  v_after := v_before;

  case p_action
    when 'intake' then
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023',
          message = '입고 수량은 0보다 커야 합니다.';
      end if;
      if v_product.tracking_mode = 'cycle'
         and p_amount <> trunc(p_amount) then
        raise exception using errcode = '22023',
          message = '개봉·소진 제품의 입고 수량은 정수로 입력해주세요.';
      end if;
      v_after := v_before + p_amount;
      v_delta := p_amount;

    when 'use' then
      if v_product.tracking_mode = 'cycle' then
        raise exception using errcode = '22023',
          message = '이 제품은 개봉·소진 버튼으로 기록해주세요.';
      end if;
      if p_amount is null or p_amount <= 0 then
        raise exception using errcode = '22023',
          message = '사용 수량은 0보다 커야 합니다.';
      end if;
      if p_amount > v_before then
        raise exception using errcode = '22023',
          message = '현재 재고보다 많이 사용할 수 없습니다.';
      end if;
      v_after := v_before - p_amount;
      v_delta := -p_amount;

    when 'open' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023',
          message = '이 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is not null then
        raise exception using errcode = '22023',
          message = '이미 사용 중인 제품이 있습니다.';
      end if;
      if v_before < 1 then
        raise exception using errcode = '22023',
          message = '개봉할 재고가 없습니다.';
      end if;
      if coalesce(p_consumer_count, v_product.current_consumer_count) < 1 then
        raise exception using errcode = '22023',
          message = '사용 인원은 1명 이상이어야 합니다.';
      end if;

      v_event_consumer_count :=
        coalesce(p_consumer_count, v_product.current_consumer_count);

      update public.inventory_products
      set active_opened_on = p_occurred_on,
          active_consumer_count = v_event_consumer_count,
          current_consumer_count = v_event_consumer_count,
          updated_by = v_user_id
      where id = v_product.id
      returning * into v_product;

    when 'finish' then
      if v_product.tracking_mode <> 'cycle' then
        raise exception using errcode = '22023',
          message = '이 제품은 사용 수량으로 기록해주세요.';
      end if;
      if v_product.active_opened_on is null then
        raise exception using errcode = '22023',
          message = '먼저 새 제품을 개봉해주세요.';
      end if;
      if p_occurred_on < v_product.active_opened_on then
        raise exception using errcode = '22023',
          message = '소진일은 개봉일보다 빠를 수 없습니다.';
      end if;
      if v_before < 1 then
        raise exception using errcode = '22023',
          message = '소진 처리할 재고가 없습니다.';
      end if;

      v_after := v_before - 1;
      v_delta := -1;
      v_event_consumer_count := coalesce(
        v_product.active_consumer_count,
        v_product.current_consumer_count,
        1
      );

      insert into public.inventory_usage_cycles (
        workspace_id,
        product_id,
        opened_on,
        finished_on,
        duration_days,
        package_size,
        capacity_unit,
        consumer_count,
        created_by
      )
      values (
        v_product.workspace_id,
        v_product.id,
        v_product.active_opened_on,
        p_occurred_on,
        (p_occurred_on - v_product.active_opened_on) + 1,
        v_product.package_size,
        v_product.capacity_unit,
        v_event_consumer_count,
        v_user_id
      );

    when 'adjustment' then
      if p_target_quantity is null or p_target_quantity < 0 then
        raise exception using errcode = '22023',
          message = '실제 재고는 0 이상이어야 합니다.';
      end if;
      if v_product.tracking_mode = 'cycle'
         and p_target_quantity <> trunc(p_target_quantity) then
        raise exception using errcode = '22023',
          message = '개봉·소진 제품의 재고는 정수 개수로 입력해주세요.';
      end if;
      v_after := p_target_quantity;
      v_delta := v_after - v_before;
      if not v_was_initialized then
        v_note := coalesce(v_note, '재고 기준 설정');
      end if;
  end case;

  if p_action <> 'open' then
    update public.inventory_products
    set current_quantity = v_after,
        stock_initialized = case
          when p_action in ('intake', 'adjustment') then true
          else stock_initialized
        end,
        active_opened_on = case
          when p_action = 'finish'
            or (p_action = 'adjustment' and v_after < 1)
            then null
          else active_opened_on
        end,
        active_consumer_count = case
          when p_action = 'finish'
            or (p_action = 'adjustment' and v_after < 1)
            then null
          else active_consumer_count
        end,
        updated_by = v_user_id
    where id = v_product.id
    returning * into v_product;
  end if;

  insert into public.inventory_events (
    workspace_id,
    product_id,
    event_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    occurred_on,
    consumer_count,
    note,
    created_by
  )
  values (
    v_product.workspace_id,
    v_product.id,
    p_action,
    v_delta,
    v_before,
    v_after,
    p_occurred_on,
    v_event_consumer_count,
    v_note,
    v_user_id
  );

  return v_product;
end;
$$;

create function public.update_active_usage(
  p_product_id uuid,
  p_opened_on date,
  p_consumer_count integer
)
returns public.inventory_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_open_event_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;
  if p_opened_on is null or p_opened_on > current_date then
    raise exception using errcode = '22023',
      message = '개봉일은 오늘 또는 과거 날짜여야 합니다.';
  end if;
  if coalesce(p_consumer_count, 0) < 1 then
    raise exception using errcode = '22023',
      message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '수정할 제품을 찾을 수 없거나 권한이 없습니다.';
  end if;
  if v_product.tracking_mode <> 'cycle'
     or v_product.active_opened_on is null then
    raise exception using errcode = '22023',
      message = '현재 사용 중인 개봉·소진 제품만 수정할 수 있습니다.';
  end if;

  select id
  into v_open_event_id
  from public.inventory_events
  where workspace_id = v_product.workspace_id
    and product_id = v_product.id
    and event_type = 'open'
    and occurred_on = v_product.active_opened_on
  order by created_at desc
  limit 1
  for update;

  if v_open_event_id is null then
    raise exception using errcode = 'P0001',
      message = '연결된 개봉 기록을 찾지 못해 수정하지 않았습니다.';
  end if;

  update public.inventory_products
  set active_opened_on = p_opened_on,
      active_consumer_count = p_consumer_count,
      current_consumer_count = p_consumer_count,
      updated_by = v_user_id
  where id = v_product.id
  returning * into v_product;

  update public.inventory_events
  set occurred_on = p_opened_on,
      consumer_count = p_consumer_count
  where id = v_open_event_id;

  return v_product;
end;
$$;

create function public.set_inventory_product_archived(
  p_product_id uuid,
  p_archived boolean
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
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;
  if p_archived and v_product.active_opened_on is not null then
    raise exception using errcode = '22023',
      message = '사용 중인 제품은 다 쓴 뒤 목록에서 숨겨주세요.';
  end if;

  update public.inventory_products
  set is_archived = p_archived,
      updated_by = v_user_id
  where id = v_product.id
  returning * into v_product;

  return v_product;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = '같은 이름의 표시 중인 제품이 있습니다.';
end;
$$;

create function public.delete_unused_inventory_product(
  p_product_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_user_id uuid := auth.uid();
  v_event_count integer;
  v_baseline_event_count integer;
  v_cycle_count integer;
  v_purchase_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found
     or not private.is_workspace_member(v_product.workspace_id) then
    raise exception using errcode = '42501',
      message = '제품을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;
  if v_product.active_opened_on is not null then
    raise exception using errcode = '22023',
      message = '사용 중인 제품은 삭제할 수 없습니다. 목록에서 숨기기를 사용해주세요.';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where event_type = 'adjustment'
        and quantity_before = 0
        and note in ('최초 재고 등록', '재고 기준 설정')
    )::integer
  into v_event_count, v_baseline_event_count
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

  if v_event_count > 1
     or (v_event_count = 1 and v_baseline_event_count <> 1)
     or v_cycle_count <> 0
     or v_purchase_count <> 0 then
    raise exception using errcode = '22023',
      message = '실사용 또는 구매 기록이 있는 제품은 삭제할 수 없습니다. 목록에서 숨기기를 사용해주세요.';
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

revoke all on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid, text
) to authenticated;

revoke all on function public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
) from public, anon, authenticated;
grant execute on function public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
) to authenticated;

revoke all on function public.update_active_usage(uuid, date, integer)
from public, anon, authenticated;
grant execute on function public.update_active_usage(uuid, date, integer)
to authenticated;

revoke all on function public.set_inventory_product_archived(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.set_inventory_product_archived(uuid, boolean)
to authenticated;

revoke all on function public.delete_unused_inventory_product(uuid)
from public, anon, authenticated;
grant execute on function public.delete_unused_inventory_product(uuid)
to authenticated;

comment on table public.inventory_products is
  'Inventory Tracker products and current stock snapshot. Quantity fields are RPC-managed.';
comment on table public.inventory_events is
  'Append-only stock, opening and depletion ledger. Client writes are not granted.';
comment on table public.inventory_usage_cycles is
  'Automatically completed open-to-finish cycles; members may correct or delete mistakes.';
comment on table public.inventory_purchases is
  'Purchase history kept separate from inventory quantity.';
comment on column public.inventory_products.is_archived is
  'When true, the product is hidden from the main list while all history is retained.';
comment on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date, uuid, text
) is 'Creates a product and an optional initial stock baseline atomically.';
comment on function public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
) is 'Sole write path for inventory quantity, active usage and append-only events.';
comment on function public.update_active_usage(uuid, date, integer) is
  'Corrects the active cycle and its linked open event in one transaction.';
comment on function public.set_inventory_product_archived(uuid, boolean) is
  'Hides or shows a product without deleting its history.';
comment on function public.delete_unused_inventory_product(uuid) is
  'Permanently deletes only products without real usage, cycle or purchase history.';

notify pgrst, 'reload schema';

commit;
