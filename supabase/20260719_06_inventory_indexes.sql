-- Cover foreign keys used by the Inventory Tracker tables.

create index if not exists inventory_products_created_by_index
  on public.inventory_products (created_by);
create index if not exists inventory_products_updated_by_index
  on public.inventory_products (updated_by);
create index if not exists inventory_events_product_workspace_index
  on public.inventory_events (product_id, workspace_id);
create index if not exists inventory_events_created_by_index
  on public.inventory_events (created_by);
create index if not exists inventory_usage_cycles_product_workspace_index
  on public.inventory_usage_cycles (product_id, workspace_id);
create index if not exists inventory_usage_cycles_created_by_index
  on public.inventory_usage_cycles (created_by);
