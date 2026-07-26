create index inventory_product_stores_product_workspace_index
  on public.inventory_product_stores (product_id, workspace_id);

create index inventory_product_stores_created_by_index
  on public.inventory_product_stores (created_by);
