import { useCallback } from "react";
import { WORKSPACE_ID } from "../../config";
import { parsePurchaseDates } from "../../lib/inventory";
import { supabase } from "../../lib/supabase";
import type {
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  PurchaseHistoryDraft,
  PurchaseDraft
} from "../../types";
import type { InventoryRefresh, RunInventoryMutation } from "./types";
import { buildPurchasePayload } from "./validation";

interface PurchaseMutationOptions {
  products: InventoryProduct[];
  stores: InventoryStore[];
  userId: string;
  refresh: InventoryRefresh;
  runMutation: RunInventoryMutation;
}

export function usePurchaseMutations({
  products,
  stores,
  userId,
  refresh,
  runMutation
}: PurchaseMutationOptions) {
  const createPurchaseHistory = useCallback(
    (product: InventoryProduct, draft: PurchaseHistoryDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const dates = parsePurchaseDates(draft.datesText);
        const storeId = draft.storeId;
        if (!stores.some((store) => store.id === storeId)) {
          throw new Error("과거 구매일을 저장할 쇼핑몰을 선택해주세요.");
        }
        const rows = dates.map((purchasedOn) => ({
          workspace_id: WORKSPACE_ID,
          product_id: product.id,
          store_id: storeId,
          purchased_on: purchasedOn,
          package_count: 1,
          package_size: null,
          package_unit: null,
          total_price: null,
          shipping_fee: null,
          note: null,
          created_by: userId,
          updated_by: userId
        }));
        const { error } = await supabase.from("inventory_purchases").insert(rows);
        if (error) throw error;
        await refresh(true);
        return dates.length;
      }),
    [refresh, runMutation, stores, userId]
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
    createPurchaseHistory,
    updatePurchase,
    deletePurchase
  };
}
