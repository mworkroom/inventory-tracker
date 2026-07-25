import { useMemo } from "react";
import {
  calculatePurchaseStats,
  estimateProduct,
  getInventoryAttentionKind,
  isInventoryAttentionNeeded,
  isRepurchaseDue
} from "../lib/inventory";
import type {
  InventoryFilter,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  InventoryViewMode,
  ProductEstimate,
  PurchaseStats
} from "../types";
import type { InventoryState } from "./inventory/types";

export interface InventoryGroup {
  key: string;
  name: string;
  products: InventoryProduct[];
}

interface InventoryViewModelOptions {
  inventory: InventoryState;
  query: string;
  filter: InventoryFilter;
  viewMode: InventoryViewMode;
}

export function useInventoryViewModel({
  inventory,
  query,
  filter,
  viewMode
}: InventoryViewModelOptions) {
  const storeById = useMemo(
    () => new Map(inventory.stores.map((store) => [store.id, store])),
    [inventory.stores]
  );

  const purchaseStats = useMemo(() => {
    const result = new Map<string, PurchaseStats>();
    inventory.products.forEach((product) => {
      result.set(
        product.id,
        calculatePurchaseStats(
          product.id,
          inventory.purchases,
          inventory.events
        )
      );
    });
    return result;
  }, [inventory.events, inventory.products, inventory.purchases]);

  const estimates = useMemo(() => {
    const result = new Map<string, ProductEstimate>();
    inventory.products.forEach((product) => {
      result.set(
        product.id,
        estimateProduct(
          product,
          inventory.events,
          inventory.cycles,
          undefined,
          purchaseStats.get(product.id) || null
        )
      );
    });
    return result;
  }, [inventory.cycles, inventory.events, inventory.products, purchaseStats]);

  const purchasesByProduct = useMemo(() => {
    const result = new Map<string, InventoryPurchase[]>();
    inventory.purchases.forEach((purchase) => {
      const list = result.get(purchase.product_id) || [];
      list.push(purchase);
      result.set(purchase.product_id, list);
    });
    return result;
  }, [inventory.purchases]);

  const counts = useMemo(
    () => ({
      all: inventory.products.length,
      attention: inventory.products.filter((product) => {
        const estimate = estimates.get(product.id);
        const stats = purchaseStats.get(product.id);
        return estimate && stats
          ? isInventoryAttentionNeeded(product, estimate, stats)
          : false;
      }).length
    }),
    [estimates, inventory.products, purchaseStats]
  );

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return [...inventory.products]
      .filter((product) => {
        const estimate = estimates.get(product.id);
        const stats = purchaseStats.get(product.id);
        if (
          filter === "attention" &&
          (!estimate ||
            !stats ||
            !isInventoryAttentionNeeded(product, estimate, stats))
        ) {
          return false;
        }
        if (!normalizedQuery) return true;

        const storeName = product.preferred_store_id
          ? storeById.get(product.preferred_store_id)?.name || ""
          : "";
        return `${product.name} ${product.category || ""} ${product.notes || ""} ${storeName}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      })
      .sort((a, b) =>
        compareProducts(a, b, estimates, purchaseStats)
      );
  }, [estimates, filter, inventory.products, purchaseStats, query, storeById]);

  const storeGroups = useMemo(
    () => groupByStore(visibleProducts, storeById),
    [storeById, visibleProducts]
  );
  const categoryGroups = useMemo(
    () => groupByCategory(visibleProducts),
    [visibleProducts]
  );
  const activeGroups = viewMode === "store" ? storeGroups : categoryGroups;

  return {
    storeById,
    purchaseStats,
    estimates,
    purchasesByProduct,
    counts,
    visibleProducts,
    storeGroups,
    categoryGroups,
    activeGroups
  };
}

function compareProducts(
  a: InventoryProduct,
  b: InventoryProduct,
  estimates: Map<string, ProductEstimate>,
  purchaseStats: Map<string, PurchaseStats>
): number {
  const aEstimate = estimates.get(a.id);
  const bEstimate = estimates.get(b.id);
  const aStockAttention =
    aEstimate && getInventoryAttentionKind(a, aEstimate) ? 1 : 0;
  const bStockAttention =
    bEstimate && getInventoryAttentionKind(b, bEstimate) ? 1 : 0;
  if (aStockAttention !== bStockAttention) {
    return bStockAttention - aStockAttention;
  }

  const aStats = purchaseStats.get(a.id);
  const bStats = purchaseStats.get(b.id);
  const aRepurchaseDue = aStats && isRepurchaseDue(a, aStats) ? 1 : 0;
  const bRepurchaseDue = bStats && isRepurchaseDue(b, bStats) ? 1 : 0;
  if (aRepurchaseDue !== bRepurchaseDue) {
    return bRepurchaseDue - aRepurchaseDue;
  }
  return a.name.localeCompare(b.name, "ko-KR");
}

function groupByStore(
  products: InventoryProduct[],
  storeById: Map<string, InventoryStore>
): InventoryGroup[] {
  const groups = new Map<
    string,
    InventoryGroup & { sortOrder: number }
  >();

  products.forEach((product) => {
    const store = product.preferred_store_id
      ? storeById.get(product.preferred_store_id) || null
      : null;
    const key = store?.id || "unassigned";
    const current = groups.get(key) || {
      key,
      name: store?.name || "구매처 미지정",
      sortOrder: store?.sort_order ?? Number.MAX_SAFE_INTEGER,
      products: []
    };
    current.products.push(product);
    groups.set(key, current);
  });

  return [...groups.values()].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko-KR")
  );
}

function groupByCategory(products: InventoryProduct[]): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  products.forEach((product) => {
    const category = product.category?.trim() || "미분류";
    const key = category.toLocaleLowerCase("ko-KR");
    const current = groups.get(key) || {
      key,
      name: category,
      products: []
    };
    current.products.push(product);
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ko-KR")
  );
}

export type InventoryViewModel = ReturnType<typeof useInventoryViewModel>;
