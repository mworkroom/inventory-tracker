import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_ID } from "../config";
import { supabase } from "../lib/supabase";
import { todayIso } from "../lib/inventory";
import type {
  InventoryAction,
  InventoryActionDraft,
  InventoryEvent,
  InventoryProduct,
  ProductDraft,
  UsageCycle
} from "../types";

interface InventoryState {
  products: InventoryProduct[];
  events: InventoryEvent[];
  cycles: UsageCycle[];
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
  exportBackup: () => Promise<void>;
  clearError: () => void;
}

export function useInventory(userId: string): InventoryState {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [cycles, setCycles] = useState<UsageCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!supabase) return;
    if (!silent) setLoading(true);
    setError(null);

    const [productsResult, eventsResult, cyclesResult] = await Promise.all([
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
        .limit(1000)
    ]);

    const firstError = productsResult.error || eventsResult.error || cyclesResult.error;
    if (firstError) {
      setError(readableError(firstError));
      setLoading(false);
      return;
    }

    setProducts((productsResult.data || []) as InventoryProduct[]);
    setEvents((eventsResult.data || []) as InventoryEvent[]);
    setCycles((cyclesResult.data || []) as UsageCycle[]);
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
        const { data, error: rpcError } = await supabase.rpc(
          "create_inventory_product",
          {
            p_workspace_id: WORKSPACE_ID,
            p_name: draft.name.trim(),
            p_tracking_mode: draft.trackingMode,
            p_unit_label: draft.unitLabel.trim(),
            p_initial_quantity: parseRequiredNumber(draft.initialQuantity, "현재 재고"),
            p_low_stock_threshold: parseRequiredNumber(
              draft.lowStockThreshold,
              "구매 기준"
            ),
            p_alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
            p_package_size:
              draft.trackingMode === "cycle"
                ? parseOptionalNumber(draft.packageSize)
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
            p_occurred_on: draft.occurredOn || todayIso()
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
        const isCapacity = product.tracking_mode === "cycle";
        const packageSize = isCapacity
          ? parseOptionalNumber(draft.packageSize)
          : null;
        const capacityUnit = isCapacity ? draft.capacityUnit.trim() : null;
        const { data, error: updateError } = await supabase
          .from("inventory_products")
          .update({
            name: draft.name.trim(),
            unit_label: isCapacity ? capacityUnit : draft.unitLabel.trim(),
            package_size: packageSize,
            capacity_unit: capacityUnit,
            low_stock_threshold: parseRequiredNumber(
              draft.lowStockThreshold,
              "구매 기준"
            ),
            alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
            current_consumer_count: isCapacity
              ? parseRequiredInteger(draft.currentConsumerCount, "사용 인원")
              : 1,
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
                ? parseRequiredNumber(draft.amount, "수량")
                : null,
            p_target_quantity:
              action === "adjustment"
                ? parseRequiredNumber(draft.targetQuantity, "실제 재고")
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

  const exportBackup = useCallback(async () => {
    if (!supabase) throw new Error("Supabase 연결이 없습니다.");
    setBusy(true);
    setError(null);

    try {
      const [allProducts, allEvents, allCycles] = await Promise.all([
        fetchAllRows<InventoryProduct>("inventory_products", "name", true),
        fetchAllRows<InventoryEvent>("inventory_events", "occurred_on", false),
        fetchAllRows<UsageCycle>("inventory_usage_cycles", "finished_on", false)
      ]);

      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        workspaceId: WORKSPACE_ID,
        products: allProducts,
        events: allEvents,
        usageCycles: allCycles
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
    loading,
    busy,
    error,
    lastLoadedAt,
    refresh,
    createProduct,
    updateProduct,
    recordAction,
    exportBackup,
    clearError: () => setError(null)
  };
}

async function fetchAllRows<T>(
  table: "inventory_products" | "inventory_events" | "inventory_usage_cycles",
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

function parseRequiredNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}을 숫자로 입력해주세요.`);
  return parsed;
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("제품 용량을 숫자로 입력해주세요.");
  return parsed;
}

function parseRequiredInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label}을 정수로 입력해주세요.`);
  return parsed;
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
