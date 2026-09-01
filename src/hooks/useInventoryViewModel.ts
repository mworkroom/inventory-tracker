import { useMemo } from "react";
import {
  calculateProductAnalysis,
  getInventoryAttentionKind,
  isInventoryAttentionNeeded,
  isRepurchaseDue
} from "../lib/observationAnalysis";
import { calculatePurchaseStats } from "../lib/inventory";
import { getProductStoreIds } from "../lib/inventoryStores";
import type {
  InventoryFilter,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  InventoryViewMode,
  ConsumptionStats,
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

  const productAnalysis = useMemo(() => {
    const estimates = new Map<string, ProductEstimate>();
    const consumptionStats = new Map<string, ConsumptionStats>();
    inventory.products.forEach((product) => {
      const analysis = calculateProductAnalysis(
        product,
        inventory.events,
        inventory.cycles,
        inventory.consumptionBaselines.find(
          (baseline) => baseline.product_id === product.id
        ) || null,
        inventory.saleSchedules
      );
      estimates.set(product.id, analysis.estimate);
      consumptionStats.set(product.id, analysis.consumptionStats);
    });
    return { estimates, consumptionStats };
  }, [
    inventory.cycles,
    inventory.consumptionBaselines,
    inventory.events,
    inventory.products,
    inventory.saleSchedules
  ]);
  const { estimates, consumptionStats } = productAnalysis;

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
          ? isInventoryAttentionNeeded(
              product,
              estimate,
              stats,
              consumptionStats.get(product.id) || null
            )
          : false;
      }).length
    }),
    [consumptionStats, estimates, inventory.products, purchaseStats]
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
            !isInventoryAttentionNeeded(
              product,
              estimate,
              stats,
              consumptionStats.get(product.id) || null
            ))
        ) {
          return false;
        }
        if (!normalizedQuery) return true;

        const storeNames = getProductStoreIds(product)
          .map((storeId) => storeById.get(storeId)?.name || "")
          .join(" ");
        return `${product.name} ${product.category || ""} ${product.notes || ""} ${storeNames}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      })
      .sort((a, b) =>
        filter === "attention"
          ? compareProducts(a, b, estimates, purchaseStats, consumptionStats)
          : a.name.localeCompare(b.name, "ko-KR")
      );
  }, [
    consumptionStats,
    estimates,
    filter,
    inventory.products,
    purchaseStats,
    query,
    storeById
  ]);

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
    consumptionStats,
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
  purchaseStats: Map<string, PurchaseStats>,
  consumptionStats: Map<string, ConsumptionStats>
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
  const aRepurchaseDue =
    aStats && isRepurchaseDue(
      a,
      aStats,
      aEstimate || null,
      consumptionStats.get(a.id) || null
    ) ? 1 : 0;
  const bRepurchaseDue =
    bStats && isRepurchaseDue(
      b,
      bStats,
      bEstimate || null,
      consumptionStats.get(b.id) || null
    ) ? 1 : 0;
  if (aRepurchaseDue !== bRepurchaseDue) {
    return bRepurchaseDue - aRepurchaseDue;
  }
  return a.name.localeCompare(b.name, "ko-KR");
}

export function groupByStore(
  products: InventoryProduct[],
  storeById: Map<string, InventoryStore>
): InventoryGroup[] {
  const groups = new Map<
    string,
    InventoryGroup & { sortOrder: number }
  >();

  products.forEach((product) => {
    const stores = getProductStoreIds(product)
      .map((storeId) => storeById.get(storeId) || null)
      .filter((store): store is InventoryStore => Boolean(store));
    const productStores = stores.length ? stores : [null];

    productStores.forEach((store) => {
      const key = store?.id || "unassigned";
      const current = groups.get(key) || {
        key,
        name: store?.name || "쇼핑몰 미지정",
        sortOrder: store?.sort_order ?? Number.MAX_SAFE_INTEGER,
        products: []
      };
      current.products.push(product);
      groups.set(key, current);
    });
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
