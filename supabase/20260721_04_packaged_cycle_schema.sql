-- Separate three practical inventory modes:
-- count    = subtract counted units directly
-- cycle    = count packages and learn one package from open to finish
-- capacity = subtract g/ml directly

alter table public.inventory_products
  add column if not exists active_remaining_quantity numeric(12, 3) null,
  add column if not exists active_remaining_updated_on date null;

alter table public.inventory_products
  drop constraint if exists inventory_products_tracking_mode_allowed,
  drop constraint if exists inventory_products_cycle_quantity_whole,
  drop constraint if exists inventory_products_active_cycle_only,
  drop constraint if exists inventory_products_active_remaining_nonnegative,
  drop constraint if exists inventory_products_active_remaining_within_package,
  drop constraint if exists inventory_products_active_remaining_date_pair;

alter table public.inventory_products
  add constraint inventory_products_tracking_mode_allowed
    check (tracking_mode in ('count', 'cycle', 'capacity')),
  add constraint inventory_products_cycle_quantity_whole
    check (tracking_mode <> 'cycle' or current_quantity = trunc(current_quantity)),
  add constraint inventory_products_active_cycle_only
    check (
      (active_opened_on is null and active_consumer_count is null)
      or
      (
        tracking_mode = 'cycle'
        and active_opened_on is not null
        and active_consumer_count is not null
      )
    ),
  add constraint inventory_products_active_remaining_nonnegative
    check (active_remaining_quantity is null or active_remaining_quantity >= 0),
  add constraint inventory_products_active_remaining_within_package
    check (
      active_remaining_quantity is null
      or
      (
        tracking_mode = 'cycle'
        and package_size is not null
        and active_remaining_quantity <= package_size
      )
    ),
  add constraint inventory_products_active_remaining_date_pair
    check (
      (active_remaining_quantity is null and active_remaining_updated_on is null)
      or
      (active_remaining_quantity is not null and active_remaining_updated_on is not null)
    );

alter table public.inventory_events
  drop constraint if exists inventory_events_type_allowed;

alter table public.inventory_events
  add constraint inventory_events_type_allowed
    check (event_type in ('intake', 'use', 'open', 'finish', 'remainder', 'adjustment'));

-- Convert the former capacity-based cycle rows to package counts while preserving
-- the measured partial amount of the currently open package.
create temporary table inventory_cycle_conversion on commit drop as
select
  id as product_id,
  current_quantity as old_quantity,
  package_size,
  case
    when current_quantity <= 0 or package_size is null then 0::numeric
    else ceil(current_quantity / package_size)
  end as new_quantity,
  case
    when current_quantity <= 0 or package_size is null then null::numeric
    when mod(current_quantity, package_size) > 0 then mod(current_quantity, package_size)
    when active_opened_on is not null then package_size
    else null::numeric
  end as active_remaining
from public.inventory_products
where tracking_mode = 'cycle';

update public.inventory_events as event
set quantity_before = 0,
    quantity_after = conversion.new_quantity,
    quantity_delta = conversion.new_quantity
from inventory_cycle_conversion as conversion
where event.product_id = conversion.product_id
  and event.event_type = 'adjustment'
  and event.note = '최초 재고 등록'
  and event.quantity_before = 0;

update public.inventory_products as product
set current_quantity = conversion.new_quantity,
    unit_label = '개',
    active_remaining_quantity = conversion.active_remaining,
    active_remaining_updated_on = case
      when conversion.active_remaining is null then null
      else current_date
    end,
    updated_at = now()
from inventory_cycle_conversion as conversion
where product.id = conversion.product_id;
