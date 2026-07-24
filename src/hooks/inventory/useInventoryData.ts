import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import { WORKSPACE_ID } from "../../config";
import { readableError } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  UsageCycle
} from "../../types";

export function useInventoryData(
  setError: Dispatch<SetStateAction<string | null>>
) {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [cycles, setCycles] = useState<UsageCycle[]>([]);
  const [stores, setStores] = useState<InventoryStore[]>([]);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(
    async (silent = false) => {
      if (!supabase) return;
      if (!silent) setLoading(true);
      setError(null);

      const [
        productsResult,
        eventsResult,
        cyclesResult,
        storesResult,
        purchasesResult
      ] = await Promise.all([
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
    },
    [setError]
  );

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

  return {
    products,
    events,
    cycles,
    stores,
    purchases,
    loading,
    lastLoadedAt,
    refresh
  };
}
