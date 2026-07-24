import type { InventoryWorkspaceController } from "../hooks/useInventoryWorkspaceController";
import type { InventoryViewModel } from "../hooks/useInventoryViewModel";
import {
  calculatePurchaseStats,
  estimateProduct,
  getInventoryAttentionKind,
  isRepurchaseDue
} from "../lib/inventory";
import type { InventoryProduct } from "../types";
import { ProductCard } from "./ProductCard";

interface InventoryListProps {
  controller: InventoryWorkspaceController;
  view: InventoryViewModel;
}

export function InventoryList({
  controller,
  view
}: InventoryListProps) {
  const { inventory, viewMode } = controller;

  function renderProductCard(product: InventoryProduct) {
    return (
      <ProductCard
        key={product.id}
        product={product}
        estimate={
          view.estimates.get(product.id) ||
          estimateProduct(
            product,
            [],
            [],
            undefined,
            view.purchaseStats.get(product.id) || null
          )
        }
        purchaseStats={
          view.purchaseStats.get(product.id) ||
          calculatePurchaseStats(product.id, [])
        }
        events={inventory.events}
        cycles={inventory.cycles}
        purchases={view.purchasesByProduct.get(product.id) || []}
        stores={inventory.stores}
        expanded={controller.expandedId === product.id}
        busy={controller.busy}
        onToggle={() =>
          controller.setExpandedId((current) =>
            current === product.id ? null : product.id
          )
        }
        onAction={(action) =>
          controller.setActionState({ product, action })
        }
        onActiveUsageEdit={() =>
          controller.setActiveUsageProduct(product)
        }
        onEdit={() => controller.setEditorProduct(product)}
        onPurchaseAdd={() =>
          controller.setPurchaseState({
            product,
            mode: "single",
            purchase: null
          })
        }
        onPurchaseBulk={() =>
          controller.setPurchaseState({
            product,
            mode: "bulk",
            purchase: null
          })
        }
        onPurchaseEdit={(purchase) =>
          controller.setPurchaseState({
            product,
            mode: "edit",
            purchase
          })
        }
        onUsageCycleEdit={(cycle) =>
          controller.setUsageCycleState({ product, cycle })
        }
        onEventAmountEdit={(event) =>
          controller.setEventCorrectionState({ product, event })
        }
      />
    );
  }

  return (
    <>
      <div className="list-heading">
        <span>
          {viewMode === "store"
            ? `구매처 ${view.storeGroups.length}곳 · 제품 ${view.visibleProducts.length}개`
            : `카테고리 ${view.categoryGroups.length}개 · 제품 ${view.visibleProducts.length}개`}
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
      ) : view.visibleProducts.length ? (
        <section
          className="store-groups"
          aria-label={
            viewMode === "store"
              ? "주구매처별 재고 목록"
              : "카테고리별 재고 목록"
          }
        >
          {view.activeGroups.map((group) => {
            const stockAttentionCount = group.products.filter((product) => {
              const estimate = view.estimates.get(product.id);
              return estimate
                ? getInventoryAttentionKind(product, estimate) !== null
                : false;
            }).length;
            const repurchaseDueCount = group.products.filter((product) => {
              const stats = view.purchaseStats.get(product.id);
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
      ) : inventory.products.length === 0 ? (
        <section className="empty-state">
          <strong>아직 등록한 제품이 없습니다.</strong>
          <span>오늘 떨어진 코코넛 오일부터 기록을 시작해보세요 ㅎㅎ</span>
          <button
            type="button"
            className="primary-button empty-add-button"
            onClick={() => controller.setEditorProduct(null)}
          >
            첫 제품 추가
          </button>
        </section>
      ) : (
        <section className="empty-state">
          <strong>조건에 맞는 제품이 없습니다.</strong>
          <span>검색어나 필터를 바꿔보세요.</span>
        </section>
      )}
    </>
  );
}
