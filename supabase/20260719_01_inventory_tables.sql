-- Inventory Tracker v1
-- Shared household inventory with event history and usage-cycle learning.

create extension if not exists pgcrypto;

create schema if not exists private;

insert into public.workspaces (id, name)
values ('00000000-0000-0000-0000-000000000002'::uuid, 'inventory-tracker')
on conflict (id) do update set name = excluded.name;

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  name text not null,
  tracking_mode text not null default 'count',
  unit_label text not null default '개',
  package_size numeric(12, 3) null,
  capacity_unit text null,
  current_quantity numeric(12, 3) not null default 0,
  low_stock_threshold numeric(12, 3) not null default 1,
  alert_days integer not null default 30,
  current_consumer_count integer not null default 1,
  active_opened_on date null,
  active_consumer_count integer null,
  notes text null,
  is_archived boolean not null default false,
  created_by uuid null references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid null references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_products_name_not_blank
    check (btrim(name) <> ''),
  constraint inventory_products_name_trimmed
    check (name = btrim(name)),
  constraint inventory_products_tracking_mode_allowed
    check (tracking_mode in ('count', 'cycle')),
  constraint inventory_products_unit_label_not_blank
    check (btrim(unit_label) <> ''),
  constraint inventory_products_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_products_capacity_unit_pair
    check (
      (package_size is null and capacity_unit is null)
      or (package_size is not null and capacity_unit is not null and btrim(capacity_unit) <> '')
    ),
  constraint inventory_products_quantity_nonnegative
    check (current_quantity >= 0),
  constraint inventory_products_threshold_nonnegative
    check (low_stock_threshold >= 0),
  constraint inventory_products_alert_days_positive
    check (alert_days >= 1),
  constraint inventory_products_consumer_count_positive
    check (current_consumer_count >= 1),
  constraint inventory_products_active_consumer_count_positive
    check (active_consumer_count is null or active_consumer_count >= 1),
  constraint inventory_products_active_cycle_only
    check (
      (active_opened_on is null and active_consumer_count is null)
      or (tracking_mode = 'cycle' and active_opened_on is not null and active_consumer_count is not null)
    ),
  constraint inventory_products_cycle_quantity_whole
    check (tracking_mode <> 'cycle' or current_quantity = trunc(current_quantity)),
  constraint inventory_products_id_workspace_unique
    unique (id, workspace_id)
);

create unique index inventory_products_workspace_name_unique
  on public.inventory_products (workspace_id, lower(name))
  where is_archived = false;

create index inventory_products_workspace_index
  on public.inventory_products (workspace_id, is_archived, name);

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
  created_by uuid null references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint inventory_events_type_allowed
    check (event_type in ('intake', 'use', 'open', 'finish', 'adjustment')),
  constraint inventory_events_quantities_nonnegative
    check (quantity_before >= 0 and quantity_after >= 0),
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
  created_by uuid null references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint inventory_usage_cycles_dates_valid
    check (finished_on >= opened_on),
  constraint inventory_usage_cycles_duration_positive
    check (duration_days >= 1),
  constraint inventory_usage_cycles_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_usage_cycles_capacity_unit_pair
    check (
      (package_size is null and capacity_unit is null)
      or (package_size is not null and capacity_unit is not null and btrim(capacity_unit) <> '')
    ),
  constraint inventory_usage_cycles_consumer_count_positive
    check (consumer_count >= 1),
  constraint inventory_usage_cycles_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id) on delete restrict
);

create index inventory_usage_cycles_product_date_index
  on public.inventory_usage_cycles (product_id, finished_on desc, created_at desc);

create index inventory_usage_cycles_workspace_index
  on public.inventory_usage_cycles (workspace_id, finished_on desc);

create or replace function private.set_inventory_product_updated_at()
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

revoke all on function private.set_inventory_product_updated_at() from public, anon, authenticated;

drop trigger if exists inventory_products_set_updated_at on public.inventory_products;

create trigger inventory_products_set_updated_at
before update on public.inventory_products
for each row execute function private.set_inventory_product_updated_at();
