import { useCallback } from "react";
import { WORKSPACE_ID } from "../../config";
import { parsePurchaseDates } from "../../lib/inventory";
import { supabase } from "../../lib/supabase";
import type {
  InventoryProduct,
  InventoryPurchase,
  PurchaseBulkDraft,
  PurchaseDraft
} from "../../types";
import type { InventoryRefresh, RunInventoryMutation } from "./types";
import {
  buildPurchaseCommonPayload,
  buildPurchasePayload
} from "./validation";

interface PurchaseMutationOptions {
  products: InventoryProduct[];
  userId: string;
  refresh: InventoryRefresh;
  runMutation: RunInventoryMutation;
}

export function usePurchaseMutations({
  products,
  userId,
  refresh,
  runMutation
}: PurchaseMutationOptions) {
  const createPurchase = useCallback(
    (product: InventoryProduct, draft: PurchaseDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const { data, error } = await supabase
          .from("inventory_purchases")
          .insert(buildPurchasePayload(product, draft, userId))
          .select("*")
          .single();
        if (error) throw error;
        await refresh(true);
        return data as InventoryPurchase;
      }),
    [refresh, runMutation, userId]
  );

  const createPurchaseBatch = useCallback(
    (product: InventoryProduct, draft: PurchaseBulkDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const dates = parsePurchaseDates(draft.datesText);
        const common = buildPurchaseCommonPayload(product, draft, userId);
        const rows = dates.map((purchasedOn) => ({
          ...common,
          purchased_on: purchasedOn,
          total_price: null,
          shipping_fee: null
        }));
        const { error } = await supabase.from("inventory_purchases").insert(rows);
        if (error) throw error;
        await refresh(true);
        return dates.length;
      }),
    [refresh, runMutation, userId]
  );

  const updatePurchase = useCallback(
    (purchase: InventoryPurchase, draft: PurchaseDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const product = products.find(
          (candidate) => candidate.id === purchase.product_id
        );
        if (!product) throw new Error("구매 기록의 제품을 찾을 수 없습니다.");

        const { data, error } = await supabase
          .from("inventory_purchases")
          .update(buildPurchasePayload(product, draft, userId))
          .eq("id", purchase.id)
          .eq("workspace_id", WORKSPACE_ID)
          .select("*")
          .single();
        if (error) throw error;
        await refresh(true);
        return data as InventoryPurchase;
      }),
    [products, refresh, runMutation, userId]
  );

  const deletePurchase = useCallback(
    (purchase: InventoryPurchase) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const { error } = await supabase
          .from("inventory_purchases")
          .delete()
          .eq("id", purchase.id)
          .eq("workspace_id", WORKSPACE_ID);
        if (error) throw error;
        await refresh(true);
      }),
    [refresh, runMutation]
  );

  return {
    createPurchase,
    createPurchaseBatch,
    updatePurchase,
    deletePurchase
  };
}
