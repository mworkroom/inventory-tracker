import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_ID } from "../config";
import { supabase } from "../lib/supabase";
import type { InventoryProduct } from "../types";

interface ProductLifecycleState {
  archivedProducts: InventoryProduct[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  refreshArchived: () => Promise<void>;
  archiveProduct: (product: InventoryProduct) => Promise<void>;
  restoreProduct: (product: InventoryProduct) => Promise<void>;
  deleteUnusedProduct: (product: InventoryProduct) => Promise<void>;
}

export function useProductLifecycle(): ProductLifecycleState {
  const [archivedProducts, setArchivedProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshArchived = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    const { data, error: selectError } = await supabase
      .from("inventory_products")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("is_archived", true)
      .order("name", { ascending: true });

    if (selectError) {
      const message = readableError(selectError);
      setError(message);
      setLoading(false);
      return;
    }

    setArchivedProducts((data || []) as InventoryProduct[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshArchived();
  }, [refreshArchived]);

  const setArchived = useCallback(
    async (product: InventoryProduct, archived: boolean) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);

      try {
        const { error: rpcError } = await supabase.rpc(
          "set_inventory_product_archived",
          {
            p_product_id: product.id,
            p_archived: archived
          }
        );
        if (rpcError) throw rpcError;
        await refreshArchived();
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refreshArchived]
  );

  const deleteUnusedProduct = useCallback(
    async (product: InventoryProduct) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setBusy(true);
      setError(null);

      try {
        const { error: rpcError } = await supabase.rpc(
          "delete_unused_inventory_product",
          { p_product_id: product.id }
        );
        if (rpcError) throw rpcError;
        await refreshArchived();
      } catch (caught) {
        const message = readableError(caught);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [refreshArchived]
  );

  return {
    archivedProducts,
    loading,
    busy,
    error,
    refreshArchived,
    archiveProduct: (product) => setArchived(product, true),
    restoreProduct: (product) => setArchived(product, false),
    deleteUnusedProduct
  };
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; details?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "제품을 처리하지 못했습니다.";
}
