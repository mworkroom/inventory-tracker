import { useCallback } from "react";
import { WORKSPACE_ID } from "../../config";
import {
  calculateStockCheckUsage,
  isStockInitialized,
  todayIso
} from "../../lib/inventory";
import { usageTrackingOf } from "../../lib/observationAnalysis";
import { supabase } from "../../lib/supabase";
import type {
  ActiveUsageDraft,
  InventoryAction,
  InventoryActionDraft,
  InventoryEvent,
  InventoryProduct,
  UsageCycle,
  UsageCycleDraft
} from "../../types";
import type { InventoryRefresh, RunInventoryMutation } from "./types";
import {
  parseRequiredInteger,
  parseRequiredNumber,
  validateUsageCycleDraft
} from "./validation";

interface RecordMutationOptions {
  cycles: UsageCycle[];
  refresh: InventoryRefresh;
  runMutation: RunInventoryMutation;
}

export function useRecordMutations({
  cycles,
  refresh,
  runMutation
}: RecordMutationOptions) {
  const recordAction = useCallback(
    (
      product: InventoryProduct,
      action: InventoryAction,
      draft: InventoryActionDraft
    ) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        let stockCheckAmount: number | null = null;
        if (action === "stock_check") {
          if (usageTrackingOf(product) !== "decrement") {
            throw new Error("남은 수량 확인은 쓸 때마다 수량을 줄이는 제품에서만 사용할 수 있습니다.");
          }
          if (!isStockInitialized(product)) {
            throw new Error("먼저 입고하거나 현재 재고를 설정해주세요.");
          }
          stockCheckAmount = calculateStockCheckUsage(
            product.current_quantity,
            draft.targetQuantity
          );
        }
        const rpcAction = action === "stock_check" ? "use" : action;
        const { data, error } = await supabase.rpc("record_inventory_action", {
          p_product_id: product.id,
          p_action: rpcAction,
          p_amount:
            action === "stock_check"
              ? stockCheckAmount
              : action === "intake" || action === "use"
                ? action === "intake" && usageTrackingOf(product) === "cycle"
                  ? parseRequiredInteger(draft.amount, "입고 개수")
                  : parseRequiredNumber(draft.amount, "수량")
                : null,
          p_target_quantity:
            action === "adjustment"
              ? usageTrackingOf(product) === "cycle"
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
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  const updateActiveUsage = useCallback(
    (product: InventoryProduct, draft: ActiveUsageDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        if (usageTrackingOf(product) !== "cycle" || !product.active_opened_on) {
          throw new Error("현재 개봉해 사용 중인 제품만 수정할 수 있습니다.");
        }
        if (!draft.openedOn || draft.openedOn > todayIso()) {
          throw new Error("개봉일은 오늘 또는 과거 날짜로 입력해주세요.");
        }
        const consumerCount = parseRequiredInteger(
          draft.consumerCount,
          "사용 인원"
        );
        if (consumerCount < 1) {
          throw new Error("사용 인원은 1명 이상이어야 합니다.");
        }

        const { data, error } = await supabase.rpc("update_active_usage", {
          p_product_id: product.id,
          p_opened_on: draft.openedOn,
          p_consumer_count: consumerCount
        });
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  const correctEventAmount = useCallback(
    (event: InventoryEvent, amount: string) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        if (event.event_type !== "intake" && event.event_type !== "use") {
          throw new Error("입고 또는 사용 기록의 수량만 수정할 수 있습니다.");
        }

        const { data, error } = await supabase.rpc(
          "update_inventory_event_amount",
          {
            p_event_id: event.id,
            p_amount: parseRequiredNumber(amount, "수정 수량")
          }
        );
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  const deleteInventoryEvent = useCallback(
    (event: InventoryEvent) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        if (event.event_type !== "intake" && event.event_type !== "use") {
          throw new Error("입고 또는 사용 기록만 삭제할 수 있습니다.");
        }

        const { data, error } = await supabase.rpc("delete_inventory_event", {
          p_event_id: event.id
        });
        if (error) throw error;
        await refresh(true);
        return data as InventoryProduct;
      }),
    [refresh, runMutation]
  );

  const updateUsageCycle = useCallback(
    (cycle: UsageCycle, draft: UsageCycleDraft) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const { consumerCount } = validateUsageCycleDraft(draft);
        if (
          cycles.some(
            (candidate) =>
              candidate.id !== cycle.id &&
              candidate.product_id === cycle.product_id &&
              candidate.opened_on === draft.openedOn &&
              candidate.finished_on === draft.finishedOn
          )
        ) {
          throw new Error("같은 개봉일과 소진일의 사용 주기가 이미 있습니다.");
        }

        const { data, error } = await supabase
          .from("inventory_usage_cycles")
          .update({
            opened_on: draft.openedOn,
            finished_on: draft.finishedOn,
            consumer_count: consumerCount
          })
          .eq("id", cycle.id)
          .eq("workspace_id", WORKSPACE_ID)
          .select("*")
          .single();
        if (error) throw error;
        await refresh(true);
        return data as UsageCycle;
      }),
    [cycles, refresh, runMutation]
  );

  const deleteUsageCycle = useCallback(
    (cycle: UsageCycle) =>
      runMutation(async () => {
        if (!supabase) throw new Error("Supabase 연결이 없습니다.");
        const { error } = await supabase
          .from("inventory_usage_cycles")
          .delete()
          .eq("id", cycle.id)
          .eq("workspace_id", WORKSPACE_ID);
        if (error) throw error;
        await refresh(true);
      }),
    [refresh, runMutation]
  );

  return {
    recordAction,
    updateActiveUsage,
    correctEventAmount,
    deleteInventoryEvent,
    updateUsageCycle,
    deleteUsageCycle
  };
}
