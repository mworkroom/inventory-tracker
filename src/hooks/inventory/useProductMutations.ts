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
  refresh: InventoryRefresh;
  runMutation: RunInventoryMutation;
}

export function useProductMutations({
  refresh,
  runMutation
}: ProductMutationOptions) {
  const createProduct = useCallback(
    (draft: ProductDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        validateCycleProductDraft(draft);
        const { data, error } = await supabase.rpc("create_inventory_product_with_stores", {
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
          p_current_consumer_count: 1,
          p_notes: draft.notes.trim() || null,
          p_store_ids: draft.storeIds,
          p_category: normalizeCategory(draft.category),
          p_next_sale_on: draft.nextSaleOn || null,
          p_purchase_coverage_months: draft.purchaseCoverageMonths
            ? parseRequiredInteger(draft.purchaseCoverageMonths, "구매할 기간")
            : null,
          p_purchase_safety_quantity: parseRequiredInteger(
            draft.purchaseSafetyQuantity,
            "여유 재고"
          ),
          p_active_months: draft.activeMonths.length === 12
            ? null
            : draft.activeMonths
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

        const { data, error } = await supabase.rpc(
          "update_inventory_product_with_stores",
          {
            p_product_id: product.id,
            p_name: draft.name.trim(),
            p_unit_label: draft.unitLabel.trim(),
            p_package_size: isCycle
              ? parseOptionalPositiveNumber(draft.packageSize, "제품 용량")
              : null,
            p_capacity_unit: isCycle ? draft.capacityUnit.trim() : null,
            p_low_stock_threshold: parseLowStockThreshold(fixedDraft),
            p_alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
            p_category: normalizeCategory(draft.category),
            p_store_ids: draft.storeIds,
            p_notes: draft.notes.trim() || null,
            p_next_sale_on: draft.nextSaleOn || null,
            p_purchase_coverage_months: draft.purchaseCoverageMonths
              ? parseRequiredInteger(draft.purchaseCoverageMonths, "구매할 기간")
              : null,
            p_purchase_safety_quantity: parseRequiredInteger(
              draft.purchaseSafetyQuantity,
              "여유 재고"
            ),
            p_active_months: draft.activeMonths.length === 12
              ? null
              : draft.activeMonths
          }
        );
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  return { createProduct, updateProduct };
}
