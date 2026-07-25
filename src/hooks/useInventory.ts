import { useCallback, useState } from "react";
import { readableError } from "../lib/errors";
import { useInventoryBackup } from "./inventory/useInventoryBackup";
import { useInventoryData } from "./inventory/useInventoryData";
import { useProductMutations } from "./inventory/useProductMutations";
import { usePurchaseMutations } from "./inventory/usePurchaseMutations";
import { useRecordMutations } from "./inventory/useRecordMutations";
import type {
  InventoryState,
  RunInventoryMutation
} from "./inventory/types";

export function useInventory(userId: string): InventoryState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = useInventoryData(setError);

  const runMutation = useCallback<RunInventoryMutation>(async (operation) => {
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (caught) {
      const message = readableError(caught);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const productMutations = useProductMutations({
    userId,
    refresh: data.refresh,
    runMutation
  });
  const recordMutations = useRecordMutations({
    cycles: data.cycles,
    refresh: data.refresh,
    runMutation
  });
  const purchaseMutations = usePurchaseMutations({
    products: data.products,
    stores: data.stores,
    userId,
    refresh: data.refresh,
    runMutation
  });
  const exportBackup = useInventoryBackup(runMutation);

  return {
    ...data,
    busy,
    error,
    ...productMutations,
    ...recordMutations,
    ...purchaseMutations,
    exportBackup
  };
}
