import { useEffect, useRef, useState } from "react";
import {
  formatDate,
  formatQuantity,
  isStockInitialized,
  todayIso
} from "../lib/inventory";
import {
  getInventoryAttentionKind,
  isRepurchaseDue,
  usageTrackingOf
} from "../lib/observationAnalysis";
import { getProductStoreIds } from "../lib/inventoryStores";
import {
  formatConsumptionAmount,
  formatConsumptionTotal,
  formatPurchaseForecast
} from "../lib/productPresentation";
import type {
  ConsumptionStats,
  InventoryAction,
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  ProductEstimate,
  PurchaseStats,
  UsageCycle
} from "../types";
import { ChevronIcon } from "./Icons";
import {
  ProductDetailsDialog,
  type ProductDetailsView
} from "./ProductDetailsDialog";

interface ProductCardProps {
  product: InventoryProduct;
  estimate: ProductEstimate;
  purchaseStats: PurchaseStats;
  consumptionStats: ConsumptionStats;
  events: InventoryEvent[];
  cycles: UsageCycle[];
  purchases: InventoryPurchase[];
  stores: InventoryStore[];
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onAction: (action: InventoryAction) => void;
  onActiveUsageEdit: () => void;
  onEdit: () => void;
  onPurchaseHistoryAdd: () => void;
  onPurchaseHistoryView: () => void;
  onPurchaseEdit: (purchase: InventoryPurchase) => void;
  onUsageCycleEdit: (cycle: UsageCycle) => void;
  onEventAmountEdit: (event: InventoryEvent) => void;
  onInventoryHistoryView: () => void;
}

export function ProductCard({
  product,
  estimate,
  purchaseStats,
  consumptionStats,
  events,
  cycles,
  purchases,
  stores,
  expanded,
  busy,
  onToggle,
  onAction,
  onActiveUsageEdit,
  onEdit,
  onPurchaseHistoryAdd,
  onPurchaseHistoryView,
  onPurchaseEdit,
  onUsageCycleEdit,
  onEventAmountEdit,
  onInventoryHistoryView
}: ProductCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [detailsView, setDetailsView] = useState<ProductDetailsView | null>(null);

  useEffect(() => {
    if (!expanded) {
      setDetailsView(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  const allProductEvents = events.filter((event) => event.product_id === product.id);
  const productCycleCount = cycles.filter((cycle) => cycle.product_id === product.id).length;
  const shoppingMallCount = getProductStoreIds(product)
    .filter((storeId) => stores.some((store) => store.id === storeId)).length;
  const isCycle = usageTrackingOf(product) === "cycle";
  const stockInitialized = isStockInitialized(product);
  const hasActiveProduct = Boolean(product.active_opened_on);
  const currentMeta = stockInitialized
    ? `${formatQuantity(product.current_quantity)}${product.unit_label}`
    : "재고 미설정";
  const inventoryAttentionKind = getInventoryAttentionKind(product, estimate);
  const repurchaseDue = isRepurchaseDue(
    product,
    purchaseStats,
    estimate,
    consumptionStats
  );
  const hasDepletionForecast = Boolean(estimate.forecastSource);
  const isRecalledForecast = estimate.forecastSource === "recalled_baseline";
  const statusClass = inventoryAttentionKind
    ? "urgent"
    : repurchaseDue
      ? "repurchase"
      : stockInitialized
        ? "okay"
        : "unknown";
  const statusLabel = inventoryAttentionKind === "quantity"
    ? "재고 확인"
    : inventoryAttentionKind === "depletion"
      ? "소진 임박"
      : repurchaseDue
        ? "재구매 시기"
        : stockInitialized
          ? "재고 여유"
          : "재고 미설정";
  const statusTitle = inventoryAttentionKind === "quantity"
    ? "재고가 얼마 안 남았어요"
    : inventoryAttentionKind === "depletion"
      ? "거의 다 써가요"
      : repurchaseDue
        ? "재구매할 때가 됐어요"
        : stockInitialized
          ? "재고는 충분해요"
          : "재고를 설정해 주세요";
  const statusDescription = inventoryAttentionKind === "quantity"
    ? `재고가 ${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하입니다.`
    : inventoryAttentionKind === "depletion" && estimate.remainingDays !== null
      ? isRecalledForecast
        ? `회상 소비 기준으로 추정하면 약 ${Math.max(0, Math.round(estimate.remainingDays))}일 후 재고가 소진됩니다.`
        : `현재 사용 속도라면 약 ${Math.max(0, Math.round(estimate.remainingDays))}일 후 재고가 소진됩니다.`
      : repurchaseDue && (consumptionStats.saleRecommendation || purchaseStats.nextPurchaseDate)
        ? consumptionStats.saleRecommendation
          ? `${consumptionStats.saleRecommendation.scheduleName} 구매 기회를 확인할 시기입니다.`
          : formatPurchaseForecast(purchaseStats.nextPurchaseDate!, purchaseStats.daysUntilNextPurchase)
        : stockInitialized
          ? hasDepletionForecast && estimate.remainingDays !== null
            ? isRecalledForecast
              ? `회상 소비 기준 약 ${Math.max(0, Math.round(estimate.remainingDays))}일분이 남았습니다.`
              : `사용 속도 기준 약 ${Math.max(0, Math.round(estimate.remainingDays))}일분이 남았습니다.`
            : isCycle
              ? "개봉일과 다 쓴 날 기록을 쌓으면 실제 사용 기간을 계산합니다."
              : "서로 다른 날짜의 사용 기록을 쌓으면 실제 사용 속도를 계산합니다."
          : "첫 입고를 기록하거나 현재 재고를 설정하면 재고 계산을 시작합니다.";

  const openDetails = (
    view: ProductDetailsView,
    trigger: HTMLButtonElement
  ) => {
    detailsTriggerRef.current = trigger;
    setDetailsView(view);
  };

  const closeDetails = (restoreFocus = true) => {
    setDetailsView(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => detailsTriggerRef.current?.focus());
    }
  };

  const launchFromDetails = (callback: () => void) => {
    closeDetails(false);
    window.requestAnimationFrame(callback);
  };

  return (
    <article ref={cardRef} className={`product-card${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="product-summary"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className={`status-dot ${statusClass}`} aria-label={statusLabel} />
        <span className="product-summary-copy">
          <span className="product-summary-name-row"><strong>{product.name}</strong></span>
          <span className="product-summary-meta">
            {currentMeta}{hasActiveProduct ? " (사용 중)" : ""}
          </span>
        </span>
        <ChevronIcon className="product-chevron" />
      </button>

      {expanded ? (
        <div className="product-details product-dashboard">
          <div className={`status-callout ${statusClass}`}>
            <strong>{statusTitle}</strong>
            <span>{statusDescription}</span>
          </div>

          <section className="product-overview-grid" aria-label="현재 제품 정보">
            <Metric label="현재 재고" value={currentMeta} emphasis />
            {isCycle && product.package_size && product.capacity_unit ? (
              <Metric
                label="제품 1개 용량"
                value={`${formatQuantity(product.package_size)}${product.capacity_unit}`}
              />
            ) : (
              <Metric label="기록 단위" value={product.unit_label} />
            )}
          </section>

          <section className="key-statistics" aria-labelledby={`key-stats-${product.id}`}>
            <div className="compact-section-heading">
              <h3 id={`key-stats-${product.id}`}>통계</h3>
              <span>{consumptionSourceLabel(consumptionStats)}</span>
            </div>
            <div className="key-statistics-grid">
              <Metric
                label="월평균 소비량"
                value={formatConsumptionAmount(consumptionStats, product.unit_label)}
              />
              <Metric
                label="1년 예상 필요량"
                value={formatConsumptionTotal(
                  consumptionStats.annualAmount,
                  consumptionStats.annualPackageCount,
                  consumptionStats.monthlyUnit,
                  product.unit_label
                )}
              />
            </div>
            {consumptionStats.saleRecommendation ? (
              <div className="sale-recommendation">
                <span>{consumptionStats.saleRecommendation.scheduleName} 구매 추천</span>
                <strong>
                  {saleOpportunityLabel(
                    consumptionStats.saleRecommendation.opportunityOn,
                    consumptionStats.saleRecommendation.validThrough
                  )}, {consumptionStats.saleRecommendation.recommendedQuantity === null
                    ? "소비량 계산 후 수량 추천"
                    : `${consumptionStats.saleRecommendation.recommendedQuantity}${product.unit_label}`}
                </strong>
                {consumptionStats.saleRecommendation.temporaryPurchaseQuantity ? (
                  <small>
                    그 전에 재고가 부족해 지금 최소 {consumptionStats.saleRecommendation.temporaryPurchaseQuantity}{product.unit_label} 필요
                  </small>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className={`quick-actions ${isCycle ? "cycle-actions" : "count-actions"}`} aria-label={`${product.name} 빠른 기록`}>
            <button type="button" disabled={busy} onClick={() => onAction("intake")}>
              <span aria-hidden="true">＋</span>입고
            </button>
            {isCycle ? (
              product.active_opened_on ? (
                <button type="button" className="quick-action-main" disabled={busy} onClick={() => onAction("finish")}>다 씀</button>
              ) : (
                <button
                  type="button"
                  className="quick-action-main"
                  disabled={busy || !stockInitialized || product.current_quantity <= 0}
                  onClick={() => onAction("open")}
                >
                  새 제품 개봉
                </button>
              )
            ) : (
              <button
                type="button"
                className="quick-action-main"
                disabled={busy || !stockInitialized || product.current_quantity <= 0}
                onClick={() => onAction("use")}
              >
                <span aria-hidden="true">−</span>사용 기록
              </button>
            )}
            {!isCycle ? (
              <button
                type="button"
                disabled={busy || !stockInitialized || product.current_quantity <= 0}
                onClick={() => onAction("stock_check")}
              >
                지금 남은 수량 확인
              </button>
            ) : null}
            {isCycle && product.active_opened_on ? (
              <button type="button" disabled={busy} onClick={onActiveUsageEdit}>사용 중 수정</button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => onAction("adjustment")}>
              {stockInitialized ? "재고 정정" : "현재 재고 설정"}
            </button>
            <button type="button" disabled={busy} onClick={onPurchaseHistoryAdd}>구매 기록</button>
          </div>

          <div className="product-detail-links" aria-label="제품 상세 메뉴">
            <button type="button" onClick={(event) => openDetails("statistics", event.currentTarget)}>
              <span><strong>상세 통계 보기</strong><small>{formatConsumptionAmount(consumptionStats, product.unit_label)}</small></span>
              <ChevronIcon />
            </button>
            <button type="button" onClick={(event) => openDetails("records", event.currentTarget)}>
              <span>
                <strong>기록과 근거</strong>
                <small>구매 {purchases.length} / 재고 {allProductEvents.length} / 사용 {productCycleCount}</small>
              </span>
              <ChevronIcon />
            </button>
            <button type="button" onClick={onEdit}>
              <span>
                <strong>제품 정보/설정</strong>
                <small>{product.category || "미분류"} / {shoppingMallCount ? `구매처 ${shoppingMallCount}곳` : "구매처 미지정"}</small>
              </span>
              <ChevronIcon />
            </button>
          </div>
        </div>
      ) : null}

      {detailsView ? (
        <ProductDetailsDialog
          initialView={detailsView}
          product={product}
          estimate={estimate}
          purchaseStats={purchaseStats}
          consumptionStats={consumptionStats}
          events={events}
          cycles={cycles}
          purchases={purchases}
          stores={stores}
          busy={busy}
          onClose={() => closeDetails()}
          onPurchaseHistoryAdd={() => launchFromDetails(onPurchaseHistoryAdd)}
          onPurchaseHistoryView={() => launchFromDetails(onPurchaseHistoryView)}
          onPurchaseEdit={(purchase) => launchFromDetails(() => onPurchaseEdit(purchase))}
          onUsageCycleEdit={(cycle) => launchFromDetails(() => onUsageCycleEdit(cycle))}
          onEventAmountEdit={(event) => launchFromDetails(() => onEventAmountEdit(event))}
          onInventoryHistoryView={() => launchFromDetails(onInventoryHistoryView)}
        />
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  emphasis = false
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`dashboard-metric${emphasis ? " emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function consumptionSourceLabel(stats: ConsumptionStats): string {
  if (stats.source === "usage") return "실제 사용 기록 기준";
  if (stats.source === "recalled_baseline") return "회상 소비 기준 임시 추정";
  return "소비량 학습 중";
}

function saleOpportunityLabel(opportunityOn: string, validThrough: string): string {
  const currentDate = todayIso();
  if (opportunityOn <= currentDate && currentDate <= validThrough) {
    return `${formatDate(validThrough)}까지`;
  }
  return formatDate(opportunityOn);
}
