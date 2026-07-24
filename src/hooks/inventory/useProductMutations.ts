import { useCallback } from "react";
import { WORKSPACE_ID } from "../../config";
import { supabase } from "../../lib/supabase";
import type { InventoryProduct, ProductDraft } from "../../types";
import type { InventoryRefresh, RunInventoryMutation } from "./types";
import {
  normalizeCategory,
  parseLowStockThreshold,
  parseOptionalPositiveNumber,
  parseRequiredInteger,
  validateCycleProductDraft
} from "./validation";

interface ProductMutationOptions {
  userId: string;
  refresh: InventoryRefresh;
  runMutation: RunInventoryMutation;
}

export function useProductMutations({
  userId,
  refresh,
  runMutation
}: ProductMutationOptions) {
  const createProduct = useCallback(
    (draft: ProductDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        validateCycleProductDraft(draft);
        const { data, error } = await supabase.rpc("create_inventory_product", {
          p_workspace_id: WORKSPACE_ID,
          p_name: draft.name.trim(),
          p_tracking_mode: draft.trackingMode,
          p_unit_label: draft.unitLabel.trim(),
          p_low_stock_threshold: parseLowStockThreshold(draft),
          p_alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
          p_package_size:
            draft.trackingMode === "cycle"
              ? parseOptionalPositiveNumber(draft.packageSize, "제품 용량")
              : null,
          p_capacity_unit:
            draft.trackingMode === "cycle" ? draft.capacityUnit.trim() : null,
          p_current_consumer_count:
            draft.trackingMode === "cycle"
              ? parseRequiredInteger(draft.currentConsumerCount, "사용 인원")
              : 1,
          p_notes: draft.notes.trim() || null,
          p_preferred_store_id: draft.preferredStoreId || null,
          p_category: normalizeCategory(draft.category)
        });
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  const updateProduct = useCallback(
    (product: InventoryProduct, draft: ProductDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const isCycle = product.tracking_mode === "cycle";
        const fixedDraft = { ...draft, trackingMode: product.tracking_mode };
        validateCycleProductDraft(fixedDraft);

        const { data, error } = await supabase
          .from("inventory_products")
          .update({
            name: draft.name.trim(),
            unit_label: draft.unitLabel.trim(),
            package_size: isCycle
              ? parseOptionalPositiveNumber(draft.packageSize, "제품 용량")
              : null,
            capacity_unit: isCycle ? draft.capacityUnit.trim() : null,
            low_stock_threshold: parseLowStockThreshold(fixedDraft),
            alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
            current_consumer_count: isCycle
              ? parseRequiredInteger(draft.currentConsumerCount, "사용 인원")
              : 1,
            category: normalizeCategory(draft.category),
            preferred_store_id: draft.preferredStoreId || null,
            notes: draft.notes.trim() || null,
            updated_by: userId
          })
          .eq("id", product.id)
          .eq("workspace_id", WORKSPACE_ID)
          .select("*")
          .single();
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation, userId]
  );

  return { createProduct, updateProduct };
}
