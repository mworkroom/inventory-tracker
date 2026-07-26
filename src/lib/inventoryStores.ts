import type {
  InventoryProduct,
  InventoryProductStore,
  InventoryStore
} from "../types";

export function getProductStoreIds(product: InventoryProduct): string[] {
  if (product.store_ids?.length) return product.store_ids;
  return product.preferred_store_id ? [product.preferred_store_id] : [];
}

export function attachProductStoreIds(
  products: InventoryProduct[],
  productStores: InventoryProductStore[],
  stores: InventoryStore[] = []
): InventoryProduct[] {
  const storeOrder = new Map(
    stores.map((store, index) => [store.id, index])
  );
  const idsByProduct = new Map<string, string[]>();

  productStores.forEach((relation) => {
    const ids = idsByProduct.get(relation.product_id) || [];
    if (!ids.includes(relation.store_id)) ids.push(relation.store_id);
    idsByProduct.set(relation.product_id, ids);
  });

  return products.map((product) => {
    const linkedIds = idsByProduct.get(product.id);
    const storeIds = linkedIds?.length
      ? [...linkedIds].sort(
          (a, b) =>
            (storeOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (storeOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
        )
      : product.preferred_store_id
        ? [product.preferred_store_id]
        : [];

    return { ...product, store_ids: storeIds };
  });
}
