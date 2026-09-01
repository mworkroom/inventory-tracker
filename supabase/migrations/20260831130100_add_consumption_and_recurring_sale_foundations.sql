-- Stage 1 of the observation-first consumption model.
-- Production migration version: 20260831130100.
--
-- This migration is intentionally additive. Existing tracking_mode,
-- active_months, next_sale_on and purchase_coverage_months contracts remain in
-- place until the application switches readers and writers in Stage 2.

alter table public.inventory_products
  add column usage_tracking text,
  add column usage_tracking_changed_on date;

update public.inventory_products
set usage_tracking = case tracking_mode
  when 'cycle' then 'cycle'
  else 'decrement'
end;

alter table public.inventory_products
  alter column usage_tracking set default 'decrement',
  alter column usage_tracking set not null,
  add constraint inventory_products_usage_tracking_allowed
    check (usage_tracking in ('decrement', 'cycle'));

comment on column public.inventory_products.usage_tracking is
  '제품의 기본 사용 기록 방식. decrement는 사용량 차감, cycle은 개봉-소진 주기이며 재고 단위와는 독립적입니다.';
comment on column public.inventory_products.usage_tracking_changed_on is
  '기본 사용 기록 방식을 미래 시점부터 바꾼 날짜. 기존 방식의 과거 기록은 그대로 보존합니다.';

create function private.sync_inventory_product_usage_tracking_from_legacy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.usage_tracking := case new.tracking_mode
    when 'cycle' then 'cycle'
    else 'decrement'
  end;

  if tg_op = 'UPDATE' then
    if new.tracking_mode is distinct from old.tracking_mode then
      new.usage_tracking_changed_on :=
        (now() at time zone 'Asia/Seoul')::date;
    end if;
  end if;

  return new;
end;
$$;

comment on function private.sync_inventory_product_usage_tracking_from_legacy() is
  '1단계 호환 기간에 기존 tracking_mode 쓰기를 새 usage_tracking 값으로 동기화합니다.';

create trigger inventory_products_sync_usage_tracking_from_legacy
before insert or update of tracking_mode
on public.inventory_products
for each row
execute function private.sync_inventory_product_usage_tracking_from_legacy();

revoke all on function private.sync_inventory_product_usage_tracking_from_legacy()
from public, anon, authenticated;

create table public.inventory_consumption_baselines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  product_id uuid not null,
  usage_tracking text not null,
  started_on date not null,
  ended_on date not null,
  consumed_quantity numeric(12, 3) not null,
  quantity_unit text not null,
  package_size numeric(12, 3) null,
  capacity_unit text null,
  consumer_count integer not null default 1,
  note text null,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  updated_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_consumption_baselines_product_unique
    unique (product_id),
  constraint inventory_consumption_baselines_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id) on delete restrict,
  constraint inventory_consumption_baselines_usage_tracking_allowed
    check (usage_tracking in ('decrement', 'cycle')),
  constraint inventory_consumption_baselines_dates_valid
    check (ended_on >= started_on),
  constraint inventory_consumption_baselines_quantity_positive
    check (consumed_quantity > 0),
  constraint inventory_consumption_baselines_cycle_quantity_one
    check (usage_tracking <> 'cycle' or consumed_quantity = 1),
  constraint inventory_consumption_baselines_quantity_unit_not_blank
    check (btrim(quantity_unit) <> ''),
  constraint inventory_consumption_baselines_quantity_unit_trimmed
    check (quantity_unit = btrim(quantity_unit)),
  constraint inventory_consumption_baselines_package_size_positive
    check (package_size is null or package_size > 0),
  constraint inventory_consumption_baselines_capacity_unit_pair
    check (
      (package_size is null and capacity_unit is null)
      or (
        package_size is not null
        and capacity_unit is not null
        and btrim(capacity_unit) <> ''
        and capacity_unit = btrim(capacity_unit)
      )
    ),
  constraint inventory_consumption_baselines_consumer_count_positive
    check (consumer_count >= 1)
);

create index inventory_consumption_baselines_workspace_index
  on public.inventory_consumption_baselines (workspace_id);

comment on table public.inventory_consumption_baselines is
  '정확한 실제 기록이 아직 없을 때만 예측을 시작하는 제품별 회상 소비 기준입니다. 재고 원장과 계절성 학습에는 포함하지 않습니다.';
comment on column public.inventory_consumption_baselines.usage_tracking is
  '회상 기준을 해석할 당시의 사용 기록 방식 스냅샷입니다.';
comment on column public.inventory_consumption_baselines.started_on is
  '회상 소비 구간의 대략적인 시작일입니다.';
comment on column public.inventory_consumption_baselines.ended_on is
  '회상 소비 구간의 대략적인 종료일입니다.';
comment on column public.inventory_consumption_baselines.consumed_quantity is
  '차감형은 구간 총사용량, 주기형은 완료한 제품 한 개를 뜻합니다.';
comment on column public.inventory_consumption_baselines.quantity_unit is
  '회상 당시 consumed_quantity의 실용 재고 단위 스냅샷입니다.';
comment on column public.inventory_consumption_baselines.package_size is
  '회상 당시 제품 한 개의 선택적 용량 스냅샷입니다.';
comment on column public.inventory_consumption_baselines.consumer_count is
  '회상 소비 구간에서 제품을 함께 사용한 인원입니다.';

create table public.inventory_product_sale_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete restrict,
  product_id uuid not null,
  store_id uuid null,
  name text not null,
  sale_month integer not null,
  sale_day integer not null,
  created_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  updated_by uuid null default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_product_sale_schedules_product_workspace_fk
    foreign key (product_id, workspace_id)
    references public.inventory_products(id, workspace_id) on delete cascade,
  constraint inventory_product_sale_schedules_store_workspace_fk
    foreign key (store_id, workspace_id)
    references public.inventory_stores(id, workspace_id) on delete restrict,
  constraint inventory_product_sale_schedules_name_not_blank
    check (btrim(name) <> ''),
  constraint inventory_product_sale_schedules_name_trimmed
    check (name = btrim(name)),
  constraint inventory_product_sale_schedules_month_valid
    check (sale_month between 1 and 12),
  constraint inventory_product_sale_schedules_day_valid
    check (
      sale_day between 1 and case
        when sale_month = 2 then 29
        when sale_month in (4, 6, 9, 11) then 30
        else 31
      end
    )
);

create unique index inventory_product_sale_schedules_identity_unique
  on public.inventory_product_sale_schedules (
    product_id,
    coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sale_month,
    sale_day,
    lower(name)
  );

create index inventory_product_sale_schedules_product_date_index
  on public.inventory_product_sale_schedules (
    product_id,
    sale_month,
    sale_day
  );

create index inventory_product_sale_schedules_workspace_index
  on public.inventory_product_sale_schedules (workspace_id);

create index inventory_product_sale_schedules_store_workspace_index
  on public.inventory_product_sale_schedules (store_id, workspace_id)
  where store_id is not null;

comment on table public.inventory_product_sale_schedules is
  '제품별로 반복되는 구매 기회를 월·일, 구매처와 행사명으로 저장하는 정기 세일 일정입니다.';
comment on column public.inventory_product_sale_schedules.store_id is
  '세일 구매처. 신규 일정은 구매처를 입력하며 기존 next_sale_on 이관 행만 비어 있을 수 있습니다.';
comment on column public.inventory_product_sale_schedules.name is
  '예: 올리브영 세일, 블랙프라이데이, 창사기념일.';
comment on column public.inventory_product_sale_schedules.sale_month is
  '연도와 무관하게 반복되는 세일 기준 월입니다.';
comment on column public.inventory_product_sale_schedules.sale_day is
  '정확한 마감일이 아니라 해당 월의 구매 기회를 찾기 위한 대략적인 기준일입니다.';

create function private.set_inventory_foundation_updated_at()
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

create trigger inventory_consumption_baselines_set_updated_at
before update on public.inventory_consumption_baselines
for each row
execute function private.set_inventory_foundation_updated_at();

create trigger inventory_product_sale_schedules_set_updated_at
before update on public.inventory_product_sale_schedules
for each row
execute function private.set_inventory_foundation_updated_at();

revoke all on function private.set_inventory_foundation_updated_at()
from public, anon, authenticated;

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
select
  product.workspace_id,
  product.id,
  coalesce(product.preferred_store_id, first_store.store_id),
  '기존 세일 일정',
  extract(month from product.next_sale_on)::integer,
  extract(day from product.next_sale_on)::integer,
  product.created_by,
  product.updated_by
from public.inventory_products as product
left join lateral (
  select product_store.store_id
  from public.inventory_product_stores as product_store
  join public.inventory_stores as store
    on store.id = product_store.store_id
   and store.workspace_id = product_store.workspace_id
  where product_store.product_id = product.id
    and product_store.workspace_id = product.workspace_id
  order by store.sort_order, product_store.created_at, product_store.store_id
  limit 1
) as first_store on true
where product.next_sale_on is not null
on conflict do nothing;

alter table public.inventory_consumption_baselines enable row level security;
alter table public.inventory_product_sale_schedules enable row level security;

revoke all on table public.inventory_consumption_baselines
from public, anon, authenticated;
revoke all on table public.inventory_product_sale_schedules
from public, anon, authenticated;

-- New public tables are not assumed to be exposed through the Data API.
-- Stage 1 intentionally grants read access only; Stage 2 will add guarded RPCs
-- for writes together with the UI that owns their validation.
grant select on table public.inventory_consumption_baselines
to authenticated;
grant select on table public.inventory_product_sale_schedules
to authenticated;

create policy inventory_consumption_baselines_select_member
on public.inventory_consumption_baselines
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy inventory_product_sale_schedules_select_member
on public.inventory_product_sale_schedules
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

notify pgrst, 'reload schema';
