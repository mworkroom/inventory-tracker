import { useCallback, useState } from "react";
import { todayIso } from "../lib/inventory";
import { supabase } from "../lib/supabase";
import type {
  InventoryAction,
  InventoryActionDraft,
  InventoryProduct
} from "../types";
import { useInventory as useInventoryBase } from "./useInventoryBase";

export function useInventory(userId: string) {
  const base = useInventoryBase(userId);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const recordAction = useCallback(
    async (
      product: InventoryProduct,
      action: InventoryAction,
      draft: InventoryActionDraft
    ) => {
      if (!supabase) throw new Error("Supabase 연결이 없습니다.");
      setActionBusy(true);
      setActionError(null);

      try {
        const amountActions: InventoryAction[] = [
          "intake",
          "use",
          "open",
          "remainder"
        ];
        const { data, error } = await supabase.rpc("record_inventory_action", {
          p_product_id: product.id,
          p_action: action,
          p_amount: amountActions.includes(action)
            ? action === "intake" && product.tracking_mode === "cycle"
              ? parseRequiredInteger(draft.amount, "입고 개수")
              : parseRequiredNumber(draft.amount, action === "remainder" ? "현재 잔량" : "수량")
            : null,
          p_target_quantity:
            action === "adjustment"
              ? product.tracking_mode === "cycle"
                ? parseRequiredInteger(draft.targetQuantity, "실제 재고 개수")
                : parseRequiredNumber(draft.targetQuantity, "실제 재고")
              : null,
          p_occurred_on: draft.occurredOn || todayIso(),
          p_consumer_count:
            action === "open"
              ? parseRequiredInteger(draft.consumerCount, "사용 인원")
              : null,
          p_note: draft.note.trim() || null
        });
        if (error) throw error;
        await base.refresh(true);
        return data as InventoryProduct;
      } catch (caught) {
        const message = readableError(caught);
        setActionError(message);
        throw new Error(message);
      } finally {
        setActionBusy(false);
      }
    },
    [base.refresh]
  );

  return {
    ...base,
    busy: base.busy || actionBusy,
    error: actionError || base.error,
    recordAction,
    clearError: () => {
      setActionError(null);
      base.clearError();
    }
  };
}

function parseRequiredNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label}을 숫자로 입력해주세요.`);
  }
  return parsed;
}

function parseRequiredInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label}을 정수로 입력해주세요.`);
  }
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
