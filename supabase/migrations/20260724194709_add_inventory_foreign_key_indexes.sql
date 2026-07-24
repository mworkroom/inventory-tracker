-- Cover every Inventory Tracker foreign-key referencing column in FK order.
-- This keeps deletes/joins predictable as the event and purchase logs grow.

create index inventory_stores_created_by_index
  on public.inventory_stores (created_by)
  where created_by is not null;

create index inventory_products_created_by_index
  on public.inventory_products (created_by)
  where created_by is not null;

create index inventory_products_updated_by_index
  on public.inventory_products (updated_by)
  where updated_by is not null;

create index inventory_events_product_workspace_fk_index
  on public.inventory_events (product_id, workspace_id);

create index inventory_events_created_by_index
  on public.inventory_events (created_by)
  where created_by is not null;

create index inventory_usage_cycles_product_workspace_fk_index
  on public.inventory_usage_cycles (product_id, workspace_id);

create index inventory_usage_cycles_created_by_index
  on public.inventory_usage_cycles (created_by)
  where created_by is not null;

create index inventory_purchases_product_workspace_fk_index
  on public.inventory_purchases (product_id, workspace_id);

create index inventory_purchases_store_workspace_fk_index
  on public.inventory_purchases (store_id, workspace_id);

create index inventory_purchases_created_by_index
  on public.inventory_purchases (created_by)
  where created_by is not null;

create index inventory_purchases_updated_by_index
  on public.inventory_purchases (updated_by)
  where updated_by is not null;
