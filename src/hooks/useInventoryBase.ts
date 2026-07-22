import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_ID } from "../config";
import { supabase } from "../lib/supabase";
import {
  parsePurchaseDates,
  todayIso,
  usageCycleDurationDays
} from "../lib/inventory";
import type {
  InventoryAction,
  InventoryActionDraft,
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  ProductDraft,
  PurchaseBulkDraft,
  PurchaseDraft,
  UsageCycle,
  UsageCycleDraft
} from "../types";

interface InventoryState {
  products: InventoryProduct[];
  events: InventoryEvent[];
  cycles: UsageCycle[];
  stores: InventoryStore[];
  purchases: InventoryPurchase[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  lastLoadedAt: Date | null;
  refresh: (silent?: boolean) => Promise<void>;
  createProduct: (draft: ProductDraft) => Promise<InventoryProduct>;
  updateProduct: (
    product: InventoryProduct,
    draft: ProductDraft
  ) => Promise<InventoryProduct>;
  recordAction: (
    product: InventoryProduct,
    action: InventoryAction,
    draft: InventoryActionDraft
  ) => Promise<InventoryProduct>;
  createUsageCycle: (
    product: InventoryProduct,
    draft: UsageCycleDraft
  ) => Promise<UsageCycle>;
  createPurchase: (
    product: InventoryProduct,
    draft: PurchaseDraft
  ) => Promise<InventoryPurchase>;
  createPurchaseBatch: (
    product: InventoryProduct,
    draft: PurchaseBulkDraft
  ) => Promise<number>;
  updatePurchase: (
    purchase: InventoryPurchase,
    draft: PurchaseDraft
  ) => Promise<InventoryPurchase>;
  deletePurchase: (purchase: InventoryPurchase) => Promise<void>;
  exportBackup: () => Promise<void>;
  clearError: () => void;
}

export function useInventory(userId: string): InventoryState {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [cycles, setCycles] = useState<UsageCycle[]>([]);
  const [stores, setStores] = useState<InventoryStore[]>([]);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!supabase) return;
    if (!silent) setLoading(true);
    setError(null);

    const [productsResult, eventsResult, cyclesResult, storesResult, purchasesResult] =
      await Promise.all([
        supabase
          .from("inventory_products")
          .select("*")
          .eq("workspace_id", WORKSPACE_ID)
          .eq("is_archived", false)
          .order("name", { ascending: true }),
        supabase
          .from("inventory_events")
          .select("*")
          .eq("workspace_id", WORKSPACE_ID)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("inventory_usage_cycles")
          .select("*")
          .eq("workspace_id", WORKSPACE_ID)
          .order("finished_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("inventory_stores")
          .select("*")
          .eq("workspace_id", WORKSPACE_ID)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("inventory_purchases")
          .select("*")
          .eq("workspace_id", WORKSPACE_ID)
          .order("purchased_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5000)
      ]);

    const firstError =
      productsResult.error ||
      eventsResult.error ||
      cyclesResult.error ||
      storesResult.error ||
      purchasesResult.error;
    if (firstError) {
      setError(readableError(firstError));
      setLoading(false);
      return;
    }

    setProducts((productsResult.data || []) as InventoryProduct[]);
    setEvents((eventsResult.data || []) as InventoryEvent[]);
    setCycles((cyclesResult.data || []) as UsageCycle[]);
    setStores((storesResult.data || []) as InventoryStore[]);
    setPurchases((purchasesResult.data || []) as InventoryPurchase[]);
    setLastLoadedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const createProduct = useCallback(
    async (draft: ProductDraft) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        validateCycleProductDraft(draft);
        const { data, error: rpcError } = await supabase.rpc(
          "create_inventory_product",
          {
            p_workspace_id: WORKSPACE_ID,
            p_name: draft.name.trim(),
            p_tracking_mode: draft.trackingMode,
            p_unit_label: draft.unitLabel.trim(),
            p_initial_quantity: null,
            p_low_stock_threshold: parseLowStockThreshold(draft),
            p_alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
            p_package_size:
              draft.trackingMode === "cycle"
                ? parseOptionalPositiveNumber(draft.packageSize, "제품 용량")
                : null,
            p_capacity_unit:
              draft.trackingMode === "cycle"
                ? draft.capacityUnit.trim()
                : null,
            p_current_consumer_count:
              draft.trackingMode === "cycle"
                ? parseRequiredInteger(draft.currentConsumerCount, "사용 인원")
                : 1,
            p_notes: draft.notes.trim() || null,
            p_occurred_on: todayIso(),
            p_preferred_store_id: draft.preferredStoreId || null
          }
        );
        if (rpcError) throw rpcError;
        await refresh(true);
        return data as InventoryProduct;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const updateProduct = useCallback(
    async (product: InventoryProduct, draft: ProductDraft) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        const isCycle = product.tracking_mode === "cycle";
        validateCycleProductDraft({ ...draft, trackingMode: product.tracking_mode });
        const packageSize = isCycle
          ? parseOptionalPositiveNumber(draft.packageSize, "제품 용량")
          : null;
        const capacityUnit = isCycle ? draft.capacityUnit.trim() : null;
        const { data, error: updateError } = await supabase
          .from("inventory_products")
          .update({
            name: draft.name.trim(),
            unit_label: draft.unitLabel.trim(),
            package_size: packageSize,
            capacity_unit: capacityUnit,
            low_stock_threshold: parseLowStockThreshold({
              ...draft,
              trackingMode: product.tracking_mode
            }),
            alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
            current_consumer_count: isCycle
              ? parseRequiredInteger(draft.currentConsumerCount, "사용 인원")
              : 1,
            preferred_store_id: draft.preferredStoreId || null,
            notes: draft.notes.trim() || null,
            updated_by: userId
          })
          .eq("id", product.id)
          .eq("workspace_id", WORKSPACE_ID)
          .select("*")
          .single();
        if (updateError) throw updateError;
        await refresh(true);
        return data as InventoryProduct;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh, userId]
  );

  const recordAction = useCallback(
    async (
      product: InventoryProduct,
      action: InventoryAction,
      draft: InventoryActionDraft
    ) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "record_inventory_action",
          {
            p_product_id: product.id,
            p_action: action,
            p_amount:
              action === "intake" || action === "use"
                ? action === "intake" && product.tracking_mode === "cycle"
                  ? parseRequiredInteger(draft.amount, "입고 개수")
                  : parseRequiredNumber(draft.amount, "수량")
                : null,
            p_target_quantity:
              action === "adjustment"
                ? product.tracking_mode === "cycle"
                  ? parseRequiredInteger(draft.targetQuantity, "실제 재고 개수")
                  : parseRequiredNumber(draft.targetQuantity, "실제 재고")
                : null,
            p_occurred_on: draft.occurredOn || todayIso(),
            p_consumer_count:
              action === "open"
                ? parseRequiredInteger(draft.consumerCount, "사용 인원")
                : null,
            p_note: draft.note.trim() || null
          }
        );
        if (rpcError) throw rpcError;
        await refresh(true);
        return data as InventoryProduct;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const createPurchase = useCallback(
    async (product: InventoryProduct, draft: PurchaseDraft) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        const payload = buildPurchasePayload(product, draft, userId);
        const { data, error: insertError } = await supabase
          .from("inventory_purchases")
          .insert(payload)
          .select("*")
          .single();
        if (insertError) throw insertError;
        await refresh(true);
        return data as InventoryPurchase;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh, userId]
  );

  const createUsageCycle = useCallback(
    async (product: InventoryProduct, draft: UsageCycleDraft) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      if (product.tracking_mode !== "cycle") {
        throw new Error("개봉·소진 방식 제품만 과거 사용 주기를 기록할 수 있습니다.");
      }

      setBusy(true);
      setError(null);
      try {
        if (!draft.openedOn || !draft.finishedOn) {
          throw new Error("개봉일과 다 쓴 날을 모두 입력해주세요.");
        }
        const durationDays = usageCycleDurationDays(draft.openedOn, draft.finishedOn);
        if (durationDays < 1) {
          throw new Error("다 쓴 날은 개봉일보다 빠를 수 없습니다.");
        }
        if (draft.finishedOn > todayIso()) {
          throw new Error("미래 날짜는 과거 사용 기록으로 저장할 수 없습니다.");
        }
        const consumerCount = parseRequiredInteger(draft.consumerCount, "사용 인원");
        if (consumerCount < 1) {
          throw new Error("사용 인원은 1명 이상이어야 합니다.");
        }
        if (
          cycles.some(
            (cycle) =>
              cycle.product_id === product.id &&
              cycle.opened_on === draft.openedOn &&
              cycle.finished_on === draft.finishedOn
          )
        ) {
          throw new Error("같은 개봉일과 소진일의 사용 주기가 이미 있습니다.");
        }

        const { data, error: insertError } = await supabase
          .from("inventory_usage_cycles")
          .insert({
            workspace_id: WORKSPACE_ID,
            product_id: product.id,
            opened_on: draft.openedOn,
            finished_on: draft.finishedOn,
            duration_days: durationDays,
            package_size: product.package_size,
            capacity_unit: product.capacity_unit,
            consumer_count: consumerCount,
            created_by: userId
          })
          .select("*")
          .single();
        if (insertError) throw insertError;
        await refresh(true);
        return data as UsageCycle;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [cycles, refresh, userId]
  );

  const createPurchaseBatch = useCallback(
    async (product: InventoryProduct, draft: PurchaseBulkDraft) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        const dates = parsePurchaseDates(draft.datesText);
        const common = buildPurchaseCommonPayload(product, draft, userId);
        const rows = dates.map((purchasedOn) => ({
          ...common,
          purchased_on: purchasedOn,
          total_price: null,
          shipping_fee: null
        }));
        const { error: insertError } = await supabase
          .from("inventory_purchases")
          .insert(rows);
        if (insertError) throw insertError;
        await refresh(true);
        return dates.length;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh, userId]
  );

  const updatePurchase = useCallback(
    async (purchase: InventoryPurchase, draft: PurchaseDraft) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        const product = products.find((candidate) => candidate.id === purchase.product_id);
        if (!product) throw new Error("구매 기록의 제품을 찾을 수 없습니다.");
        const payload = buildPurchasePayload(product, draft, userId);
        const { data, error: updateError } = await supabase
          .from("inventory_purchases")
          .update(payload)
          .eq("id", purchase.id)
          .eq("workspace_id", WORKSPACE_ID)
          .select("*")
          .single();
        if (updateError) throw updateError;
        await refresh(true);
        return data as InventoryPurchase;
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [products, refresh, userId]
  );

  const deletePurchase = useCallback(
    async (purchase: InventoryPurchase) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);
      try {
        const { error: deleteError } = await supabase
          .from("inventory_purchases")
          .delete()
          .eq("id", purchase.id)
          .eq("workspace_id", WORKSPACE_ID);
        if (deleteError) throw deleteError;
        await refresh(true);
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const exportBackup = useCallback(async () => {
    if (!supabase) throw new Error("Supabase 연결이 없습니다.");
    setBusy(true);
    setError(null);

    try {
      const [allProducts, allEvents, allCycles, allStores, allPurchases] =
        await Promise.all([
          fetchAllRows<InventoryProduct>("inventory_products", "name", true),
          fetchAllRows<InventoryEvent>("inventory_events", "occurred_on", false),
          fetchAllRows<UsageCycle>("inventory_usage_cycles", "finished_on", false),
          fetchAllRows<InventoryStore>("inventory_stores", "sort_order", true),
          fetchAllRows<InventoryPurchase>("inventory_purchases", "purchased_on", false)
        ]);

      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        workspaceId: WORKSPACE_ID,
        products: allProducts,
        events: allEvents,
        usageCycles: allCycles,
        stores: allStores,
        purchases: allPurchases
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `inventory-backup-${todayIso()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      const message = readableError(caught);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    products,
    events,
    cycles,
    stores,
    purchases,
    loading,
    busy,
    error,
    lastLoadedAt,
    refresh,
    createProduct,
    updateProduct,
    recordAction,
    createUsageCycle,
    createPurchase,
    createPurchaseBatch,
    updatePurchase,
    deletePurchase,
    exportBackup,
    clearError: () => setError(null)
  };
}

type BackupTable =
  | "inventory_products"
  | "inventory_events"
  | "inventory_usage_cycles"
  | "inventory_stores"
  | "inventory_purchases";

async function fetchAllRows<T>(
  table: BackupTable,
  orderColumn: string,
  ascending: boolean
): Promise<T[]> {
  if (!supabase) throw new Error("Supabase 연결이 없습니다.");

  const pageSize = 1000;
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .order(orderColumn, { ascending })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    from += pageSize;
  }
}

function buildPurchasePayload(
  product: InventoryProduct,
  draft: PurchaseDraft,
  userId: string
) {
  if (!draft.purchasedOn) throw new Error("구매일을 입력해주세요.");
  return {
    ...buildPurchaseCommonPayload(product, draft, userId),
    purchased_on: draft.purchasedOn,
    total_price: parseOptionalNonnegativeNumber(draft.totalPrice, "총 결제금액"),
    shipping_fee: parseOptionalNonnegativeNumber(draft.shippingFee, "배송비")
  };
}

function buildPurchaseCommonPayload(
  product: InventoryProduct,
  draft: PurchaseDraft | PurchaseBulkDraft,
  userId: string
) {
  if (!draft.storeId) throw new Error("구매처를 선택해주세요.");
  const packageCount = parseRequiredInteger(draft.packageCount, "구매 수량");
  if (packageCount < 1) throw new Error("구매 수량은 1 이상이어야 합니다.");

  const packageSize = parseOptionalPositiveNumber(draft.packageSize, "제품 용량");
  const packageUnit = draft.packageUnit.trim() || null;
  if ((packageSize === null) !== (packageUnit === null)) {
    throw new Error("제품 용량과 용량 단위를 함께 입력해주세요.");
  }

  return {
    workspace_id: WORKSPACE_ID,
    product_id: product.id,
    store_id: draft.storeId,
    package_count: packageCount,
    package_size: packageSize,
    package_unit: packageUnit,
    note: draft.note.trim() || null,
    created_by: userId,
    updated_by: userId
  };
}

function parseRequiredNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}을 숫자로 입력해주세요.`);
  return parsed;
}

function parseOptionalPositiveNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}은 0보다 큰 숫자로 입력해주세요.`);
  }
  return parsed;
}

function parseOptionalNonnegativeNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}은 0 이상의 숫자로 입력해주세요.`);
  }
  return parsed;
}

function parseRequiredInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label}을 정수로 입력해주세요.`);
  return parsed;
}

function parseLowStockThreshold(draft: ProductDraft): number {
  const threshold = draft.trackingMode === "cycle"
    ? parseRequiredInteger(draft.lowStockThreshold, "구매 기준")
    : parseRequiredNumber(draft.lowStockThreshold, "구매 기준");
  if (threshold < 0) throw new Error("구매 기준은 0 이상이어야 합니다.");
  return threshold;
}

function validateCycleProductDraft(draft: ProductDraft): void {
  if (draft.trackingMode !== "cycle") return;
  if (
    draft.unitLabel.trim().toLowerCase() ===
    draft.capacityUnit.trim().toLowerCase()
  ) {
    throw new Error("재고 단위에는 통·병·봉처럼 포장 개수를 나타내는 말을 입력해주세요.");
  }
  const consumerCount = parseRequiredInteger(draft.currentConsumerCount, "사용 인원");
  if (consumerCount < 1) throw new Error("사용 인원은 1명 이상이어야 합니다.");
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; details?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "데이터를 처리하지 못했습니다.";
}
