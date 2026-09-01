import { useState } from "react";
import type { InventoryWorkspaceController } from "../hooks/useInventoryWorkspaceController";
import type { InventoryViewModel } from "../hooks/useInventoryViewModel";
import {
  calculateConsumptionStats,
  estimateProduct,
  isInventoryAttentionNeeded
} from "../lib/observationAnalysis";
import { calculatePurchaseStats } from "../lib/inventory";
import type { InventoryProduct } from "../types";
import { GroupByMenu } from "./GroupByMenu";
import { CategoryIcon, ChevronIcon, StoreIcon } from "./Icons";
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
  const [groupOpenOverrides, setGroupOpenOverrides] = useState<
    Record<string, boolean>
  >({});

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
            null
          )
        }
        purchaseStats={
          view.purchaseStats.get(product.id) ||
          calculatePurchaseStats(product.id, [], [])
        }
        consumptionStats={
          view.consumptionStats.get(product.id) ||
          calculateConsumptionStats(
            product,
            [],
            [],
            null,
            []
          )
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
        onPurchaseHistoryAdd={() =>
          controller.setPurchaseState({
            product,
            mode: "history",
            purchase: null
          })
        }
        onPurchaseHistoryView={() =>
          controller.setPurchaseState({
            product,
            mode: "list",
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
        onInventoryHistoryView={() =>
          controller.setInventoryHistoryProduct(product)
        }
      />
    );
  }

  return (
    <>
      <div className="list-heading">
        <div className="list-heading-copy">
          <span>
            {viewMode === "store"
              ? `쇼핑몰 ${view.storeGroups.length}곳 · 제품 ${view.visibleProducts.length}개`
              : `카테고리 ${view.categoryGroups.length}개 · 제품 ${view.visibleProducts.length}개`}
          </span>
        </div>
        <GroupByMenu
          value={viewMode}
          onChange={controller.setViewMode}
        />
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
              ? "쇼핑몰별 재고 목록"
              : "카테고리별 재고 목록"
          }
        >
          {view.activeGroups.map((group) => {
            const attentionCount = group.products.filter((product) => {
              const estimate = view.estimates.get(product.id);
              const stats = view.purchaseStats.get(product.id);
              return estimate && stats
                ? isInventoryAttentionNeeded(
                    product,
                    estimate,
                    stats,
                    view.consumptionStats.get(product.id) || null
                  )
                : false;
            }).length;
            const groupStateKey = `${viewMode}:${group.key}`;
            const hasExpandedProduct = group.products.some(
              (product) => product.id === controller.expandedId
            );
            const isGroupOpen =
              Boolean(controller.query.trim()) ||
              hasExpandedProduct ||
              (groupOpenOverrides[groupStateKey] ?? false);

            return (
              <section key={group.key} className="store-group">
                <h2 className="store-group-heading">
                  <button
                    type="button"
                    aria-expanded={isGroupOpen}
                    onClick={() => {
                      if (isGroupOpen && hasExpandedProduct) {
                        controller.setExpandedId(null);
                      }
                      setGroupOpenOverrides((current) => ({
                        ...current,
                        [groupStateKey]: !isGroupOpen
                      }));
                    }}
                  >
                    <span className="store-group-label">
                      {viewMode === "category" ? (
                        <CategoryIcon
                          category={group.name}
                          className="category-icon"
                        />
                      ) : (
                        <StoreIcon store={group.name} className="store-icon" />
                      )}
                      <span className="store-group-copy">
                        <strong>{group.name}</strong>
                        <span>
                          {group.products.length}개 · 확인 {attentionCount}
                        </span>
                      </span>
                    </span>
                    <ChevronIcon className="store-group-chevron" />
                  </button>
                </h2>
                {isGroupOpen ? (
                  <div className="product-list">
                    {group.products.map(renderProductCard)}
                  </div>
                ) : null}
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
