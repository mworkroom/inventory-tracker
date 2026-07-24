import { useMemo, useState } from "react";
import { ActionDialog } from "./components/ActionDialog";
import { ActiveUsageDialog } from "./components/ActiveUsageDialog";
import { ArchivedProductsDialog } from "./components/ArchivedProductsDialog";
import { AuthGate, type AuthorizedContext } from "./components/AuthGate";
import { EventAmountDialog } from "./components/EventAmountDialog";
import { FilterTabs } from "./components/FilterTabs";
import { Header } from "./components/Header";
import { ProductCard } from "./components/ProductCard";
import { ProductEditor } from "./components/ProductEditor";
import {
  PurchaseDialog,
  type PurchaseDialogMode
} from "./components/PurchaseDialog";
import { SearchBar } from "./components/SearchBar";
import { UsageCycleDialog } from "./components/UsageCycleDialog";
import { ViewModeToggle } from "./components/ViewModeToggle";
import { useInventory } from "./hooks/useInventory";
import { useProductLifecycle } from "./hooks/useProductLifecycle";
import {
  actionPastTense,
  calculatePurchaseStats,
  estimateProduct,
  getInventoryAttentionKind,
  isRepurchaseDue
} from "./lib/inventory";
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
  ProductEstimate,
  PurchaseBulkDraft,
  PurchaseDraft,
  PurchaseStats,
  UsageCycle,
  UsageCycleDraft
} from "./types";

export default function App() {
  return (
    <AuthGate>
      {(context) => <InventoryWorkspace {...context} />}
    </AuthGate>
  );
}

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

interface StoreGroup {
  key: string;
  name: string;
  sortOrder: number;
  products: InventoryProduct[];
}

type CategoryGroup = Omit<StoreGroup, "sortOrder">;

function InventoryWorkspace({ userId, email, signOut }: AuthorizedContext) {
  const inventory = useInventory(userId);
  const lifecycle = useProductLifecycle();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [viewMode, setViewMode] = useState<InventoryViewMode>("category");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editorProduct, setEditorProduct] = useState<InventoryProduct | null | undefined>(undefined);
  const [actionState, setActionState] = useState<{
    product: InventoryProduct;
    action: InventoryAction;
  } | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>(null);
  const [activeUsageProduct, setActiveUsageProduct] = useState<InventoryProduct | null>(null);
  const [usageCycleState, setUsageCycleState] = useState<UsageCycleState>(null);
  const [eventCorrectionState, setEventCorrectionState] =
    useState<EventCorrectionState>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const busy = inventory.busy || lifecycle.busy;

  const storeById = useMemo(
    () => new Map(inventory.stores.map((store) => [store.id, store])),
    [inventory.stores]
  );

  const purchaseStats = useMemo(() => {
    const result = new Map<string, PurchaseStats>();
    inventory.products.forEach((product) => {
      result.set(product.id, calculatePurchaseStats(product.id, inventory.purchases));
    });
    return result;
  }, [inventory.products, inventory.purchases]);

  const estimates = useMemo(() => {
    const result = new Map<string, ProductEstimate>();
    inventory.products.forEach((product) => {
      result.set(
        product.id,
        estimateProduct(
          product,
          inventory.events,
          inventory.cycles,
          undefined,
          purchaseStats.get(product.id) || null
        )
      );
    });
    return result;
  }, [inventory.cycles, inventory.events, inventory.products, purchaseStats]);

  const purchasesByProduct = useMemo(() => {
    const result = new Map<string, InventoryPurchase[]>();
    inventory.purchases.forEach((purchase) => {
      const list = result.get(purchase.product_id) || [];
      list.push(purchase);
      result.set(purchase.product_id, list);
    });
    return result;
  }, [inventory.purchases]);

  const counts = useMemo(
    () => ({
      all: inventory.products.length,
      stock: inventory.products.filter((product) => {
        const estimate = estimates.get(product.id);
        return estimate
          ? getInventoryAttentionKind(product, estimate) !== null
          : false;
      }).length,
      repurchase: inventory.products.filter((product) => {
        const stats = purchaseStats.get(product.id);
        return stats ? isRepurchaseDue(product, stats) : false;
      }).length,
      learning: inventory.products.filter((product) => estimates.get(product.id)?.isLearning).length
    }),
    [estimates, inventory.products, purchaseStats]
  );

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return [...inventory.products]
      .filter((product) => {
        const estimate = estimates.get(product.id);
        const stats = purchaseStats.get(product.id);
        if (
          filter === "stock" &&
          (!estimate || getInventoryAttentionKind(product, estimate) === null)
        ) {
          return false;
        }
        if (
          filter === "repurchase" &&
          (!stats || !isRepurchaseDue(product, stats))
        ) {
          return false;
        }
        if (filter === "learning" && !estimate?.isLearning) return false;
        if (!normalizedQuery) return true;
        const storeName = product.preferred_store_id
          ? storeById.get(product.preferred_store_id)?.name || ""
          : "";
        return `${product.name} ${product.category || ""} ${product.notes || ""} ${storeName}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aEstimate = estimates.get(a.id);
        const bEstimate = estimates.get(b.id);
        const aStockAttention =
          aEstimate && getInventoryAttentionKind(a, aEstimate) ? 1 : 0;
        const bStockAttention =
          bEstimate && getInventoryAttentionKind(b, bEstimate) ? 1 : 0;
        if (aStockAttention !== bStockAttention) {
          return bStockAttention - aStockAttention;
        }
        const aStats = purchaseStats.get(a.id);
        const bStats = purchaseStats.get(b.id);
        const aRepurchaseDue = aStats && isRepurchaseDue(a, aStats) ? 1 : 0;
        const bRepurchaseDue = bStats && isRepurchaseDue(b, bStats) ? 1 : 0;
        if (aRepurchaseDue !== bRepurchaseDue) {
          return bRepurchaseDue - aRepurchaseDue;
        }
        return a.name.localeCompare(b.name, "ko-KR");
      });
  }, [estimates, filter, inventory.products, purchaseStats, query, storeById]);

  const storeGroups = useMemo<StoreGroup[]>(() => {
    const groups = new Map<string, StoreGroup>();

    visibleProducts.forEach((product) => {
      const store = product.preferred_store_id
        ? storeById.get(product.preferred_store_id) || null
        : null;
      const key = store?.id || "unassigned";
      const current = groups.get(key) || {
        key,
        name: store?.name || "구매처 미지정",
        sortOrder: store?.sort_order ?? Number.MAX_SAFE_INTEGER,
        products: []
      };
      current.products.push(product);
      groups.set(key, current);
    });

    return [...groups.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko-KR")
    );
  }, [storeById, visibleProducts]);

  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const groups = new Map<string, CategoryGroup>();

    visibleProducts.forEach((product) => {
      const category = product.category?.trim() || "미분류";
      const key = category.toLocaleLowerCase("ko-KR");
      const current = groups.get(key) || {
        key,
        name: category,
        products: []
      };
      current.products.push(product);
      groups.set(key, current);
    });

    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  }, [visibleProducts]);

  const editorCanDelete = editorProduct
    ? canDeleteUnusedProduct(
        editorProduct,
        inventory.events,
        inventory.cycles,
        inventory.purchases
      )
    : false;

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
    showToast(`${saved.name} ${actionPastTense(actionState.action)} 기록했습니다.`);
  }

  async function savePurchase(draft: PurchaseDraft) {
    if (!purchaseState || purchaseState.mode === "bulk") return;
    if (purchaseState.mode === "edit" && purchaseState.purchase) {
      await inventory.updatePurchase(purchaseState.purchase, draft);
      showToast("구매 기록을 수정했습니다.");
    } else {
      await inventory.createPurchase(purchaseState.product, draft);
      showToast("구매 기록을 저장했습니다.");
    }
    setExpandedId(purchaseState.product.id);
    setPurchaseState(null);
  }

  async function savePurchaseBatch(draft: PurchaseBulkDraft) {
    if (!purchaseState || purchaseState.mode !== "bulk") return;
    const count = await inventory.createPurchaseBatch(purchaseState.product, draft);
    setExpandedId(purchaseState.product.id);
    setPurchaseState(null);
    showToast(`과거 구매 기록 ${count}건을 저장했습니다.`);
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
    const saved = await inventory.updateActiveUsage(activeUsageProduct, draft);
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
    if (!usageCycleState?.cycle) return;
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
    showToast("구매 기록을 삭제했습니다.");
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

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 2800);
  }

  function refresh() {
    void Promise.all([inventory.refresh(), lifecycle.refreshArchived()]).then(() =>
      showToast("최신 재고를 불러왔습니다.")
    );
  }

  async function backup() {
    try {
      await inventory.exportBackup();
      showToast("재고와 구매 기록을 JSON 백업 파일로 저장했습니다.");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "백업 파일을 만들지 못했습니다.");
    }
  }

  function renderProductCard(product: InventoryProduct) {
    return (
      <ProductCard
        key={product.id}
        product={product}
        estimate={
          estimates.get(product.id) ||
          estimateProduct(
            product,
            [],
            [],
            undefined,
            purchaseStats.get(product.id) || null
          )
        }
        purchaseStats={
          purchaseStats.get(product.id) || calculatePurchaseStats(product.id, [])
        }
        events={inventory.events}
        cycles={inventory.cycles}
        purchases={purchasesByProduct.get(product.id) || []}
        stores={inventory.stores}
        expanded={expandedId === product.id}
        busy={busy}
        onToggle={() =>
          setExpandedId((current) => (current === product.id ? null : product.id))
        }
        onAction={(action) => setActionState({ product, action })}
        onActiveUsageEdit={() => setActiveUsageProduct(product)}
        onEdit={() => setEditorProduct(product)}
        onPurchaseAdd={() =>
          setPurchaseState({ product, mode: "single", purchase: null })
        }
        onPurchaseBulk={() =>
          setPurchaseState({ product, mode: "bulk", purchase: null })
        }
        onPurchaseEdit={(purchase) =>
          setPurchaseState({ product, mode: "edit", purchase })
        }
        onUsageCycleEdit={(cycle) => setUsageCycleState({ product, cycle })}
        onEventAmountEdit={(event) =>
          setEventCorrectionState({ product, event })
        }
      />
    );
  }

  const activeGroups = viewMode === "store" ? storeGroups : categoryGroups;

  return (
    <main className="app-shell">
      <Header
        email={email}
        busy={busy}
        archivedCount={lifecycle.archivedProducts.length}
        onAdd={() => setEditorProduct(null)}
        onOpenArchived={() => {
          setArchivedOpen(true);
          void lifecycle.refreshArchived();
        }}
        onRefresh={refresh}
        onBackup={backup}
        onSignOut={signOut}
      />

      <section className="inventory-controls" aria-label="재고 검색과 필터">
        <SearchBar value={query} onChange={setQuery} />
        <FilterTabs value={filter} counts={counts} onChange={setFilter} />
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </section>

      {inventory.error ? (
        <div className="error-banner" role="alert">
          <span>{inventory.error}</span>
          <button type="button" onClick={() => void inventory.refresh()}>
            다시 불러오기
          </button>
        </div>
      ) : null}

      <div className="list-heading">
        <span>
          {viewMode === "store"
            ? `구매처 ${storeGroups.length}곳 · 제품 ${visibleProducts.length}개`
            : viewMode === "category"
              ? `카테고리 ${categoryGroups.length}개 · 제품 ${visibleProducts.length}개`
            : query || filter !== "all"
              ? `${visibleProducts.length}개 표시 중`
              : `제품 ${inventory.products.length}개`}
        </span>
        {inventory.lastLoadedAt ? (
          <small>
            {inventory.lastLoadedAt.toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit"
            })}
            에 확인
          </small>
        ) : null}
      </div>

      {inventory.loading ? (
        <div className="loading-list" aria-label="재고를 불러오는 중">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="loading-card" />
          ))}
        </div>
      ) : visibleProducts.length ? (
        viewMode === "store" || viewMode === "category" ? (
          <section
            className="store-groups"
            aria-label={viewMode === "store" ? "주구매처별 재고 목록" : "카테고리별 재고 목록"}
          >
            {activeGroups.map((group) => {
              const stockAttentionCount = group.products.filter((product) => {
                const estimate = estimates.get(product.id);
                return estimate
                  ? getInventoryAttentionKind(product, estimate) !== null
                  : false;
              }).length;
              const repurchaseDueCount = group.products.filter((product) => {
                const stats = purchaseStats.get(product.id);
                return stats ? isRepurchaseDue(product, stats) : false;
              }).length;

              return (
                <section key={group.key} className="store-group">
                  <header className="store-group-heading">
                    <div>
                      <strong>{group.name}</strong>
                      <span>{group.products.length}개</span>
                    </div>
                    <small>
                      {stockAttentionCount > 0
                        ? `재고·소진 확인 ${stockAttentionCount}`
                        : "재고·소진 확인 없음"}
                      {repurchaseDueCount > 0
                        ? ` · 재구매 시기 ${repurchaseDueCount}`
                        : ""}
                    </small>
                  </header>
                  <div className="product-list">
                    {group.products.map(renderProductCard)}
                  </div>
                </section>
              );
            })}
          </section>
        ) : (
          <section className="product-list" aria-label="재고 목록">
            {visibleProducts.map(renderProductCard)}
          </section>
        )
      ) : inventory.products.length === 0 ? (
        <section className="empty-state">
          <strong>아직 등록한 제품이 없습니다.</strong>
          <span>오늘 떨어진 코코넛 오일부터 기록을 시작해보세요 ㅎㅎ</span>
          <button type="button" className="primary-button empty-add-button" onClick={() => setEditorProduct(null)}>
            첫 제품 추가
          </button>
        </section>
      ) : (
        <section className="empty-state">
          <strong>조건에 맞는 제품이 없습니다.</strong>
          <span>검색어나 필터를 바꿔보세요.</span>
        </section>
      )}

      {editorProduct !== undefined ? (
        <ProductEditor
          product={editorProduct}
          stores={inventory.stores}
          busy={busy}
          canDelete={editorCanDelete}
          onClose={() => setEditorProduct(undefined)}
          onSubmit={saveProduct}
          onArchive={editorProduct ? archiveEditedProduct : null}
          onDelete={editorProduct ? deleteEditedProduct : null}
        />
      ) : null}

      {actionState ? (
        <ActionDialog
          product={actionState.product}
          action={actionState.action}
          busy={busy}
          onClose={() => setActionState(null)}
          onSubmit={saveAction}
        />
      ) : null}

      {purchaseState ? (
        <PurchaseDialog
          product={purchaseState.product}
          stores={inventory.stores}
          purchase={purchaseState.purchase}
          mode={purchaseState.mode}
          busy={busy}
          onClose={() => setPurchaseState(null)}
          onSubmitSingle={savePurchase}
          onSubmitBulk={savePurchaseBatch}
          onDelete={purchaseState.mode === "edit" ? deletePurchase : null}
        />
      ) : null}

      {activeUsageProduct ? (
        <ActiveUsageDialog
          product={activeUsageProduct}
          busy={busy}
          onClose={() => setActiveUsageProduct(null)}
          onSubmit={saveActiveUsage}
        />
      ) : null}

      {usageCycleState ? (
        <UsageCycleDialog
          product={usageCycleState.product}
          cycle={usageCycleState.cycle}
          busy={busy}
          onClose={() => setUsageCycleState(null)}
          onSubmit={saveUsageCycle}
          onDelete={deleteUsageCycle}
        />
      ) : null}

      {eventCorrectionState ? (
        <EventAmountDialog
          product={eventCorrectionState.product}
          event={eventCorrectionState.event}
          busy={busy}
          onClose={() => setEventCorrectionState(null)}
          onSubmit={saveEventAmount}
        />
      ) : null}

      {archivedOpen ? (
        <ArchivedProductsDialog
          products={lifecycle.archivedProducts}
          stores={inventory.stores}
          loading={lifecycle.loading}
          busy={busy}
          error={lifecycle.error}
          onClose={() => setArchivedOpen(false)}
          onRestore={restoreArchivedProduct}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}

function canDeleteUnusedProduct(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  purchases: InventoryPurchase[]
): boolean {
  if (product.active_opened_on) return false;

  const productEvents = events.filter((event) => event.product_id === product.id);
  const hasNoRealInventoryHistory =
    productEvents.length === 0 ||
    (productEvents.length === 1 &&
      productEvents[0].event_type === "adjustment" &&
      productEvents[0].quantity_before === 0 &&
      ["최초 재고 등록", "재고 기준 설정"].includes(productEvents[0].note || ""));

  return (
    hasNoRealInventoryHistory &&
    !cycles.some((cycle) => cycle.product_id === product.id) &&
    !purchases.some((purchase) => purchase.product_id === product.id)
  );
}
