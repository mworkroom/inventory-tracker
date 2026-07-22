-- 개봉·소진 제품의 현재 재고와 구매 기준은 포장 개수로만 관리합니다.
-- 과거 용량 직접 차감 값이 cycle 제품에 남은 경우 해당 제품의 재고 기준만
-- 초기화하고, 구매 기록과 제품 설정 자체는 보존합니다.

begin;

create temporary table legacy_cycle_product_ids (
  id uuid primary key
) on commit drop;

insert into legacy_cycle_product_ids (id)
select id
from public.inventory_products
where tracking_mode = 'cycle'
  and (
    lower(btrim(unit_label)) = lower(btrim(coalesce(capacity_unit, '')))
    or current_quantity <> trunc(current_quantity)
    or low_stock_threshold <> trunc(low_stock_threshold)
  );

-- 용량 값으로 작성된 재고·사용 주기 기록은 포장 개수 기록으로 해석할 수 없으므로
-- 선택된 legacy 제품에 한해서만 제거합니다. 구매 기록은 주기 참고용으로 보존합니다.
delete from public.inventory_events
where product_id in (select id from legacy_cycle_product_ids);

delete from public.inventory_usage_cycles
where product_id in (select id from legacy_cycle_product_ids);

update public.inventory_products
set unit_label = '개',
    current_quantity = 0,
    stock_initialized = false,
    low_stock_threshold = 1,
    active_opened_on = null,
    active_consumer_count = null,
    active_remaining_quantity = null,
    active_remaining_updated_on = null
where id in (select id from legacy_cycle_product_ids);

alter table public.inventory_products
  drop constraint if exists inventory_products_cycle_quantity_integer;

alter table public.inventory_products
  add constraint inventory_products_cycle_quantity_integer
    check (tracking_mode <> 'cycle' or current_quantity = trunc(current_quantity));

alter table public.inventory_products
  drop constraint if exists inventory_products_cycle_threshold_integer;

alter table public.inventory_products
  add constraint inventory_products_cycle_threshold_integer
    check (tracking_mode <> 'cycle' or low_stock_threshold = trunc(low_stock_threshold));

alter table public.inventory_products
  drop constraint if exists inventory_products_cycle_package_unit_distinct;

alter table public.inventory_products
  add constraint inventory_products_cycle_package_unit_distinct
    check (
      tracking_mode <> 'cycle'
      or lower(btrim(unit_label)) <> lower(btrim(coalesce(capacity_unit, '')))
    );

comment on constraint inventory_products_cycle_quantity_integer
  on public.inventory_products is
  '개봉·소진 제품의 현재 재고는 통·병·봉의 정수 개수로 저장합니다.';

comment on constraint inventory_products_cycle_threshold_integer
  on public.inventory_products is
  '개봉·소진 제품의 구매 경고 기준은 포장 단위 정수 개수로 저장합니다.';

comment on constraint inventory_products_cycle_package_unit_distinct
  on public.inventory_products is
  '개봉·소진 제품의 재고 단위와 내용물 용량 단위는 서로 달라야 합니다.';

notify pgrst, 'reload schema';

commit;
