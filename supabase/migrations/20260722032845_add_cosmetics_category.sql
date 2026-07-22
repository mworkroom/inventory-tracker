-- Add cosmetics to the fixed product category list.

begin;

update public.inventory_products
set category = '미분류'
where category is null
   or category not in ('식료품', '화장품', '생활용품', '영양제', '의복', '미분류');

alter table public.inventory_products
  drop constraint if exists inventory_products_category_allowed;

alter table public.inventory_products
  add constraint inventory_products_category_allowed
  check (category in ('식료품', '화장품', '생활용품', '영양제', '의복', '미분류'));

comment on column public.inventory_products.category is
  'Fixed inventory grouping category: 식료품, 화장품, 생활용품, 영양제, 의복, or 미분류.';

notify pgrst, 'reload schema';

commit;
