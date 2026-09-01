-- Cover the composite product foreign keys and audit-user foreign keys added
-- Production migration version: 20260831130834.
-- by the observation model. These indexes keep parent updates/deletes and
-- ownership maintenance from scanning the new tables.

create index inventory_baselines_product_workspace_idx
  on public.inventory_consumption_baselines (product_id, workspace_id);

create index inventory_baselines_created_by_idx
  on public.inventory_consumption_baselines (created_by);

create index inventory_baselines_updated_by_idx
  on public.inventory_consumption_baselines (updated_by);

create index inventory_sale_schedules_product_workspace_idx
  on public.inventory_product_sale_schedules (product_id, workspace_id);

create index inventory_sale_schedules_created_by_idx
  on public.inventory_product_sale_schedules (created_by);

create index inventory_sale_schedules_updated_by_idx
  on public.inventory_product_sale_schedules (updated_by);
