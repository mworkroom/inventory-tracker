import { useCallback } from "react";
import { WORKSPACE_ID } from "../../config";
import { usageTrackingOf } from "../../lib/observationAnalysis";
import { supabase } from "../../lib/supabase";
import type {
  ConsumptionBaselineDraft,
  InventoryConsumptionBaseline,
  InventoryProduct,
  ProductDraft
} from "../../types";
import type { InventoryRefresh, RunInventoryMutation } from "./types";
import {
  normalizeCategory,
  parseLowStockThreshold,
  parseOptionalPositiveNumber,
  parseRequiredInteger,
  validateConsumptionBaselineDraft,
  validateProductDraft
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
        validateProductDraft(draft);
        const { data, error } = await supabase.rpc(
          "create_inventory_product_with_schedules",
          buildProductPayload(draft, { p_workspace_id: WORKSPACE_ID })
        );
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
        validateProductDraft(draft);
        const { data, error } = await supabase.rpc(
          "update_inventory_product_with_schedules",
          buildProductPayload(draft, { p_product_id: product.id })
        );
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  const upsertConsumptionBaseline = useCallback(
    (product: InventoryProduct, draft: ConsumptionBaselineDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const usageTracking = usageTrackingOf(product);
        const { consumedQuantity, consumerCount } =
          validateConsumptionBaselineDraft(draft, usageTracking);
        const { data, error } = await supabase.rpc(
          "upsert_inventory_consumption_baseline",
          {
            p_product_id: product.id,
            p_started_on: draft.startedOn,
            p_ended_on: draft.endedOn,
            p_consumed_quantity: consumedQuantity,
            p_consumer_count: consumerCount,
            p_note: draft.note.trim() || null
          }
        );
        if (error) throw error;
        await refresh(true);
        return data as InventoryConsumptionBaseline;
      }),
    [refresh, runMutation]
  );

  const deleteConsumptionBaseline = useCallback(
    (product: InventoryProduct) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const { error } = await supabase.rpc(
          "delete_inventory_consumption_baseline",
          { p_product_id: product.id }
        );
        if (error) throw error;
        await refresh(true);
      }),
    [refresh, runMutation]
  );

  return {
    createProduct,
    updateProduct,
    upsertConsumptionBaseline,
    deleteConsumptionBaseline
  };
}

function buildProductPayload(
  draft: ProductDraft,
  identity: { p_workspace_id: string } | { p_product_id: string }
) {
  return {
    ...identity,
    p_name: draft.name.trim(),
    p_usage_tracking: draft.usageTracking,
    p_unit_label: draft.unitLabel.trim(),
    p_low_stock_threshold: parseLowStockThreshold(draft),
    p_alert_days: parseRequiredInteger(draft.alertDays, "알림 기준일"),
    p_package_size: parseOptionalPositiveNumber(draft.packageSize, "제품 용량"),
    p_capacity_unit: draft.capacityUnit.trim() || null,
    p_notes: draft.notes.trim() || null,
    p_store_ids: draft.storeIds,
    p_category: normalizeCategory(draft.category),
    p_purchase_safety_quantity: parseRequiredInteger(
      draft.purchaseSafetyQuantity,
      "여유 재고"
    ),
    p_sale_schedules: draft.saleSchedules.map((schedule) => ({
      store_id: schedule.storeId,
      name: schedule.name.trim(),
      sale_month: parseRequiredInteger(schedule.saleMonth, "정기 세일 월"),
      sale_day: parseRequiredInteger(schedule.saleDay, "정기 세일 일")
    }))
  };
}
