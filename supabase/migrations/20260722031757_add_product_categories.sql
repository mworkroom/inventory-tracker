-- Products use a fixed set of inventory categories without changing inventory history.

begin;

alter table public.inventory_products
  add column if not exists category text;

update public.inventory_products
set category = case
  when category in ('식료품', '생활용품', '영양제', '의복', '미분류') then category
  else '미분류'
end
where category is null
   or btrim(category) = ''
   or category not in ('식료품', '생활용품', '영양제', '의복', '미분류');

alter table public.inventory_products
  alter column category set default '미분류',
  alter column category set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_products_category_allowed'
      and conrelid = 'public.inventory_products'::regclass
  ) then
    alter table public.inventory_products
      add constraint inventory_products_category_allowed
      check (category in ('식료품', '생활용품', '영양제', '의복', '미분류'));
  end if;
end
$$;

comment on column public.inventory_products.category is
  'Fixed inventory grouping category: 식료품, 생활용품, 영양제, 의복, or 미분류.';

notify pgrst, 'reload schema';

commit;
