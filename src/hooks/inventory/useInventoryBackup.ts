import { useCallback } from "react";
import { WORKSPACE_ID } from "../../config";
import { todayIso } from "../../lib/inventory";
import { supabase } from "../../lib/supabase";
import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  UsageCycle
} from "../../types";
import type { RunInventoryMutation } from "./types";

type BackupTable =
  | "inventory_products"
  | "inventory_events"
  | "inventory_usage_cycles"
  | "inventory_stores"
  | "inventory_purchases";

export function useInventoryBackup(runMutation: RunInventoryMutation) {
  return useCallback(
    () =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const [products, events, cycles, stores, purchases] = await Promise.all([
          fetchAllRows<InventoryProduct>("inventory_products", "name", true),
          fetchAllRows<InventoryEvent>("inventory_events", "occurred_on", false),
          fetchAllRows<UsageCycle>(
            "inventory_usage_cycles",
            "finished_on",
            false
          ),
          fetchAllRows<InventoryStore>("inventory_stores", "sort_order", true),
          fetchAllRows<InventoryPurchase>(
            "inventory_purchases",
            "purchased_on",
            false
          )
        ]);

        const payload = {
          version: 2,
          exportedAt: new Date().toISOString(),
          workspaceId: WORKSPACE_ID,
          products,
          events,
          usageCycles: cycles,
          stores,
          purchases
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
      }),
    [runMutation]
  );
}

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
