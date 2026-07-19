import { useMemo, useState } from "react";
import { ActionDialog } from "./components/ActionDialog";
import { AuthGate, type AuthorizedContext } from "./components/AuthGate";
import { FilterTabs } from "./components/FilterTabs";
import { Header } from "./components/Header";
import { ProductCard } from "./components/ProductCard";
import { ProductEditor } from "./components/ProductEditor";
import { SearchBar } from "./components/SearchBar";
import { useInventory } from "./hooks/useInventory";
import { actionPastTense, estimateProduct } from "./lib/inventory";
import type {
  InventoryAction,
  InventoryActionDraft,
  InventoryFilter,
  InventoryProduct,
  ProductDraft,
  ProductEstimate
} from "./types";

export default function App() {
  return (
    <AuthGate>
      {(context) => <InventoryWorkspace {...context} />}
    </AuthGate>
  );
}

function InventoryWorkspace({ userId, email, signOut }: AuthorizedContext) {
  const inventory = useInventory(userId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editorProduct, setEditorProduct] = useState<InventoryProduct | null | undefined>(undefined);
  const [actionState, setActionState] = useState<{
    product: InventoryProduct;
    action: InventoryAction;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const estimates = useMemo(() => {
    const result = new Map<string, ProductEstimate>();
    inventory.products.forEach((product) => {
      result.set(product.id, estimateProduct(product, inventory.events, inventory.cycles));
    });
    return result;
  }, [inventory.cycles, inventory.events, inventory.products]);

  const counts = useMemo(
    () => ({
      all: inventory.products.length,
      urgent: inventory.products.filter((product) => estimates.get(product.id)?.isUrgent).length,
      learning: inventory.products.filter((product) => estimates.get(product.id)?.isLearning).length
    }),
    [estimates, inventory.products]
  );

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return [...inventory.products]
      .filter((product) => {
        const estimate = estimates.get(product.id);
        if (filter === "urgent" && !estimate?.isUrgent) return false;
        if (filter === "learning" && !estimate?.isLearning) return false;
        if (!normalizedQuery) return true;
        return `${product.name} ${product.notes || ""}`
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aUrgent = estimates.get(a.id)?.isUrgent ? 1 : 0;
        const bUrgent = estimates.get(b.id)?.isUrgent ? 1 : 0;
        if (aUrgent !== bUrgent) return bUrgent - aUrgent;
        return a.name.localeCompare(b.name, "ko-KR");
      });
  }, [estimates, filter, inventory.products, query]);

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

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 2800);
  }

  function refresh() {
    void inventory.refresh().then(() => showToast("최신 재고를 불러왔습니다."));
  }

  async function backup() {
    try {
      await inventory.exportBackup();
      showToast("전체 기록을 JSON 백업 파일로 저장했습니다.");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "백업 파일을 만들지 못했습니다.");
    }
  }

  return (
    <main className="app-shell">
      <Header
        email={email}
        busy={inventory.busy}
        onAdd={() => setEditorProduct(null)}
        onRefresh={refresh}
        onBackup={backup}
        onSignOut={signOut}
      />

      <section className="inventory-controls" aria-label="재고 검색과 필터">
        <SearchBar value={query} onChange={setQuery} />
        <FilterTabs value={filter} counts={counts} onChange={setFilter} />
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
          {query || filter !== "all"
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
        <section className="product-list" aria-label="재고 목록">
          {visibleProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              estimate={estimates.get(product.id) || estimateProduct(product, [], [])}
              events={inventory.events}
              cycles={inventory.cycles}
              expanded={expandedId === product.id}
              busy={inventory.busy}
              onToggle={() =>
                setExpandedId((current) => (current === product.id ? null : product.id))
              }
              onAction={(action) => setActionState({ product, action })}
              onEdit={() => setEditorProduct(product)}
            />
          ))}
        </section>
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
          busy={inventory.busy}
          onClose={() => setEditorProduct(undefined)}
          onSubmit={saveProduct}
        />
      ) : null}

      {actionState ? (
        <ActionDialog
          product={actionState.product}
          action={actionState.action}
          busy={inventory.busy}
          onClose={() => setActionState(null)}
          onSubmit={saveAction}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
