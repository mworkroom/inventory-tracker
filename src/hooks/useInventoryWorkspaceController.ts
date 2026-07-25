import { useState } from "react";
import type { PurchaseDialogMode } from "../components/PurchaseDialog";
import { actionPastTense } from "../lib/inventory";
import { canDeleteUnusedProduct } from "../lib/inventoryProducts";
import type {
  ActiveUsageDraft,
  InventoryAction,
  InventoryActionDraft,
  InventoryEvent,
  InventoryFilter,
  InventoryProduct,
  InventoryPurchase,
  InventoryViewMode,
  ProductDraft,
  PurchaseHistoryDraft,
  PurchaseDraft,
  UsageCycle,
  UsageCycleDraft
} from "../types";
import { useInventory } from "./useInventory";
import { useProductLifecycle } from "./useProductLifecycle";

type PurchaseState = {
  product: InventoryProduct;
  mode: PurchaseDialogMode;
  purchase: InventoryPurchase | null;
} | null;

type UsageCycleState = {
  product: InventoryProduct;
  cycle: UsageCycle;
} | null;

type EventCorrectionState = {
  product: InventoryProduct;
  event: InventoryEvent;
} | null;

export function useInventoryWorkspaceController(userId: string) {
  const inventory = useInventory(userId);
  const lifecycle = useProductLifecycle();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [viewMode, setViewMode] = useState<InventoryViewMode>("category");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editorProduct, setEditorProduct] = useState<
    InventoryProduct | null | undefined
  >(undefined);
  const [actionState, setActionState] = useState<{
    product: InventoryProduct;
    action: InventoryAction;
  } | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>(null);
  const [activeUsageProduct, setActiveUsageProduct] =
    useState<InventoryProduct | null>(null);
  const [usageCycleState, setUsageCycleState] =
    useState<UsageCycleState>(null);
  const [eventCorrectionState, setEventCorrectionState] =
    useState<EventCorrectionState>(null);
  const [learningStatusOpen, setLearningStatusOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const busy = inventory.busy || lifecycle.busy;

  const editorCanDelete = editorProduct
    ? canDeleteUnusedProduct(
        editorProduct,
        inventory.events,
        inventory.cycles,
        inventory.purchases
      )
    : false;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 2800);
  }

  async function saveProduct(draft: ProductDraft) {
    const saved = editorProduct
      ? await inventory.updateProduct(editorProduct, draft)
      : await inventory.createProduct(draft);
    setEditorProduct(undefined);
    setExpandedId(saved.id);
    showToast(`${saved.name}을 저장했습니다.`);
  }

  async function saveAction(draft: InventoryActionDraft) {
    if (!actionState) return;
    const saved = await inventory.recordAction(
      actionState.product,
      actionState.action,
      draft
    );
    setActionState(null);
    setExpandedId(saved.id);
    showToast(
      `${saved.name} ${actionPastTense(actionState.action)} 기록했습니다.`
    );
  }

  async function savePurchaseEdit(draft: PurchaseDraft) {
    if (
      !purchaseState ||
      purchaseState.mode !== "edit" ||
      !purchaseState.purchase
    ) return;
    await inventory.updatePurchase(purchaseState.purchase, draft);
    showToast("과거 구매일을 수정했습니다.");
    setExpandedId(purchaseState.product.id);
    setPurchaseState(null);
  }

  async function savePurchaseHistory(draft: PurchaseHistoryDraft) {
    if (!purchaseState || purchaseState.mode !== "history") return;
    const count = await inventory.createPurchaseHistory(
      purchaseState.product,
      draft
    );
    setExpandedId(purchaseState.product.id);
    setPurchaseState(null);
    showToast(`과거 구매일 ${count}개를 저장했습니다.`);
  }

  async function saveUsageCycle(draft: UsageCycleDraft) {
    if (!usageCycleState) return;
    await inventory.updateUsageCycle(usageCycleState.cycle, draft);
    showToast("사용 주기를 수정했습니다.");
    setExpandedId(usageCycleState.product.id);
    setUsageCycleState(null);
  }

  async function saveActiveUsage(draft: ActiveUsageDraft) {
    if (!activeUsageProduct) return;
    const saved = await inventory.updateActiveUsage(
      activeUsageProduct,
      draft
    );
    setExpandedId(saved.id);
    setActiveUsageProduct(null);
    showToast("사용 중 정보와 개봉 기록을 함께 수정했습니다.");
  }

  async function saveEventAmount(amount: string) {
    if (!eventCorrectionState) return;
    const saved = await inventory.correctEventAmount(
      eventCorrectionState.event,
      amount
    );
    setExpandedId(saved.id);
    setEventCorrectionState(null);
    showToast("재고 기록 수량과 현재 재고를 함께 수정했습니다.");
  }

  async function deleteUsageCycle() {
    if (!usageCycleState) return;
    const productId = usageCycleState.product.id;
    await inventory.deleteUsageCycle(usageCycleState.cycle);
    setExpandedId(productId);
    setUsageCycleState(null);
    showToast("사용 주기를 삭제했습니다.");
  }

  async function deletePurchase() {
    if (!purchaseState?.purchase) return;
    const productId = purchaseState.product.id;
    await inventory.deletePurchase(purchaseState.purchase);
    setExpandedId(productId);
    setPurchaseState(null);
    showToast("과거 구매일을 삭제했습니다.");
  }

  async function archiveEditedProduct() {
    if (!editorProduct) return;
    const name = editorProduct.name;
    await lifecycle.archiveProduct(editorProduct);
    await inventory.refresh(true);
    setEditorProduct(undefined);
    setExpandedId(null);
    showToast(`${name}을 목록에서 숨겼습니다.`);
  }

  async function deleteEditedProduct() {
    if (!editorProduct) return;
    const name = editorProduct.name;
    await lifecycle.deleteUnusedProduct(editorProduct);
    await inventory.refresh(true);
    setEditorProduct(undefined);
    setExpandedId(null);
    showToast(`${name}을 영구 삭제했습니다.`);
  }

  async function restoreArchivedProduct(product: InventoryProduct) {
    await lifecycle.restoreProduct(product);
    await inventory.refresh(true);
    showToast(`${product.name}을 목록에 다시 표시했습니다.`);
  }

  function refreshAll() {
    void Promise.all([inventory.refresh(), lifecycle.refreshArchived()]).then(
      () => showToast("최신 재고를 불러왔습니다.")
    );
  }

  async function backup() {
    try {
      await inventory.exportBackup();
      showToast("재고와 구매 기록을 JSON 백업 파일로 저장했습니다.");
    } catch (caught) {
      showToast(
        caught instanceof Error
          ? caught.message
          : "백업 파일을 만들지 못했습니다."
      );
    }
  }

  function openArchived() {
    setArchivedOpen(true);
    void lifecycle.refreshArchived();
  }

  return {
    inventory,
    lifecycle,
    busy,
    query,
    setQuery,
    filter,
    setFilter,
    viewMode,
    setViewMode,
    expandedId,
    setExpandedId,
    editorProduct,
    setEditorProduct,
    editorCanDelete,
    actionState,
    setActionState,
    purchaseState,
    setPurchaseState,
    activeUsageProduct,
    setActiveUsageProduct,
    usageCycleState,
    setUsageCycleState,
    eventCorrectionState,
    setEventCorrectionState,
    learningStatusOpen,
    setLearningStatusOpen,
    archivedOpen,
    setArchivedOpen,
    toast,
    refreshAll,
    backup,
    openArchived,
    saveProduct,
    saveAction,
    savePurchaseEdit,
    savePurchaseHistory,
    saveUsageCycle,
    saveActiveUsage,
    saveEventAmount,
    deleteUsageCycle,
    deletePurchase,
    archiveEditedProduct,
    deleteEditedProduct,
    restoreArchivedProduct
  };
}

export type InventoryWorkspaceController = ReturnType<
  typeof useInventoryWorkspaceController
>;
