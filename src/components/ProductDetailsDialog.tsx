import { useEffect, useState } from "react";
import {
  eventLabel,
  formatApproxDays,
  formatDate,
  formatQuantity,
  isStockInitialized
} from "../lib/inventory";
import {
  formatActiveMeta,
  formatActiveMonths,
  formatAnnualizedMonthlyAmount,
  formatConsumptionAmount,
  formatConsumptionTotal,
  formatDecimal,
  formatHistoryRange
} from "../lib/productPresentation";
import type {
  ConsumptionStats,
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  ProductEstimate,
  PurchaseStats,
  UsageCycle
} from "../types";
import { CloseIcon } from "./Icons";

export type ProductDetailsView = "statistics" | "records";
type RecordView = "purchase" | "inventory" | "usage";

interface ProductDetailsDialogProps {
  initialView: ProductDetailsView;
  product: InventoryProduct;
  estimate: ProductEstimate;
  purchaseStats: PurchaseStats;
  consumptionStats: ConsumptionStats;
  events: InventoryEvent[];
  cycles: UsageCycle[];
  purchases: InventoryPurchase[];
  stores: InventoryStore[];
  busy: boolean;
  onClose: () => void;
  onPurchaseHistoryAdd: () => void;
  onPurchaseHistoryView: () => void;
  onPurchaseEdit: (purchase: InventoryPurchase) => void;
  onUsageCycleEdit: (cycle: UsageCycle) => void;
  onEventAmountEdit: (event: InventoryEvent) => void;
  onInventoryHistoryView: () => void;
}

export function ProductDetailsDialog({
  initialView,
  product,
  estimate,
  purchaseStats,
  consumptionStats,
  events,
  cycles,
  purchases,
  stores,
  busy,
  onClose,
  onPurchaseHistoryAdd,
  onPurchaseHistoryView,
  onPurchaseEdit,
  onUsageCycleEdit,
  onEventAmountEdit,
  onInventoryHistoryView
}: ProductDetailsDialogProps) {
  const [view, setView] = useState<ProductDetailsView>(initialView);
  const [recordView, setRecordView] = useState<RecordView>("purchase");
  const productEvents = events
    .filter((event) => event.product_id === product.id)
    .sort(sortByDateAndCreatedAt);
  const productCycles = cycles
    .filter((cycle) => cycle.product_id === product.id)
    .sort((a, b) => b.finished_on.localeCompare(a.finished_on));
  const storeById = new Map(stores.map((store) => [store.id, store.name]));
  const isCycle = product.tracking_mode === "cycle";
  const stockInitialized = isStockInitialized(product);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="action-dialog product-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-details-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="product-details-dialog-title">
              {view === "statistics" ? "상세 통계" : "기록과 근거"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="product-details-tabs" role="tablist" aria-label="제품 상세 정보">
          <button
            type="button"
            role="tab"
            aria-selected={view === "statistics"}
            className={view === "statistics" ? "active" : ""}
            onClick={() => setView("statistics")}
          >
            상세 통계
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "records"}
            className={view === "records" ? "active" : ""}
            onClick={() => setView("records")}
          >
            기록과 근거
          </button>
        </div>

        {view === "statistics" ? (
          <div className="product-details-panel" role="tabpanel">
            <StatisticsPanel
              product={product}
              estimate={estimate}
              purchaseStats={purchaseStats}
              consumptionStats={consumptionStats}
              stockInitialized={stockInitialized}
              isCycle={isCycle}
            />
          </div>
        ) : (
          <div className="product-details-panel" role="tabpanel">
            <div className="record-tabs" role="tablist" aria-label="기록 종류">
              <RecordTab
                active={recordView === "purchase"}
                label="구매"
                count={purchases.length}
                onClick={() => setRecordView("purchase")}
              />
              <RecordTab
                active={recordView === "inventory"}
                label="재고"
                count={productEvents.length}
                onClick={() => setRecordView("inventory")}
              />
              <RecordTab
                active={recordView === "usage"}
                label="사용"
                count={productCycles.length}
                onClick={() => setRecordView("usage")}
              />
            </div>

            {recordView === "purchase" ? (
              <PurchaseRecords
                product={product}
                purchases={purchases}
                purchaseStats={purchaseStats}
                storeById={storeById}
                busy={busy}
                onAdd={onPurchaseHistoryAdd}
                onViewAll={onPurchaseHistoryView}
                onEdit={onPurchaseEdit}
              />
            ) : null}
            {recordView === "inventory" ? (
              <InventoryRecords
                product={product}
                events={productEvents}
                busy={busy}
                onViewAll={onInventoryHistoryView}
                onEdit={onEventAmountEdit}
              />
            ) : null}
            {recordView === "usage" ? (
              <UsageRecords
                product={product}
                cycles={productCycles}
                busy={busy}
                onEdit={onUsageCycleEdit}
              />
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function StatisticsPanel({
  product,
  estimate,
  purchaseStats,
  consumptionStats,
  stockInitialized,
  isCycle
}: {
  product: InventoryProduct;
  estimate: ProductEstimate;
  purchaseStats: PurchaseStats;
  consumptionStats: ConsumptionStats;
  stockInitialized: boolean;
  isCycle: boolean;
}) {
  const hasDepletionForecast =
    estimate.forecastSource === "usage" || estimate.forecastSource === "purchase_volume";
  const depletionForecastStatus =
    estimate.forecastSource === "usage"
      ? "실제 사용 기준"
      : estimate.forecastSource === "purchase_volume"
        ? "구매량 추정"
        : "사용 기록 학습 중";
  const depletionForecastSuffix =
    estimate.forecastSource === "purchase_volume" ? " (과거 구매량 추정)" : "";

  return (
    <div className="details-statistics">
      <section className="forecast-section stock-forecast-section">
        <div className="forecast-section-heading">
          <h3>재고/사용 기준</h3>
          <span className="forecast-status neutral">
            {depletionForecastStatus}
          </span>
        </div>
        <dl className="product-info forecast-info">
          {isCycle ? (
            <>
              <InfoRow label="사용 현황" value={formatActiveMeta(product)} />
              <InfoRow
                label="평균 사용 주기"
                value={estimate.expectedCycleDays === null
                  ? "첫 소진 기록을 기다리는 중"
                  : `${formatApproxDays(estimate.expectedCycleDays)} (최근 ${estimate.cycleSampleCount}회 기준)`}
              />
              {estimate.perPersonDailyCapacity !== null && product.capacity_unit ? (
                <InfoRow
                  label="1인 사용량"
                  value={`하루 약 ${formatDecimal(estimate.perPersonDailyCapacity)}${product.capacity_unit}`}
                />
              ) : null}
            </>
          ) : (
            <InfoRow
              label="최근 사용 속도"
              value={estimate.daysPerUnit === null
                ? "서로 다른 날짜의 사용 기록 2개가 필요함"
                : `${formatApproxDays(estimate.daysPerUnit)}에 1${product.unit_label} (최근 ${estimate.useSampleCount}일 기록 기준)`}
            />
          )}
          <InfoRow
            label="예상 소진 시기"
            value={hasDepletionForecast && estimate.estimatedOutDate
              ? `${formatDate(estimate.estimatedOutDate)}, ${formatApproxDays(estimate.remainingDays)}${depletionForecastSuffix}`
              : stockInitialized
                ? isCycle
                  ? "완료된 사용 주기를 기록하면 계산"
                  : "서로 다른 날짜의 사용 기록 2개부터 계산"
                : "현재 재고 설정 후 계산"}
          />
          <InfoRow
            label="재고 알림 기준"
            value={`예상 소진 ${product.alert_days}일 전 / 소진 예측이 없으면 ${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하`}
          />
        </dl>
      </section>

      <section className="forecast-section purchase-forecast-section">
        <div className="forecast-section-heading">
          <h3>구매/소비 통계</h3>
          <span className="forecast-status neutral">
            {consumptionStats.source === "usage"
              ? "실제 사용 기록 기준"
              : consumptionStats.source === "purchase"
                ? "과거 구매량 기준"
                : "소비량 학습 전"}
          </span>
        </div>
        <dl className="product-info forecast-info">
          <InfoRow
            label="구매 기록"
            value={purchaseStats.purchaseRecordCount > 0
              ? `${purchaseStats.purchaseRecordCount}건 (총 ${formatQuantity(purchaseStats.totalPackageCount)}${product.unit_label})`
              : "아직 없음"}
          />
          <InfoRow
            label="최근 실제 구매"
            value={purchaseStats.lastPurchasedOn && purchaseStats.lastPurchasePackageCount !== null
              ? `${formatDate(purchaseStats.lastPurchasedOn)}, ${formatQuantity(purchaseStats.lastPurchasePackageCount)}${product.unit_label}`
              : "아직 없음"}
          />
          <InfoRow
            label="최근 입고"
            value={purchaseStats.latestIntakeOn && purchaseStats.latestIntakeQuantity !== null
              ? `${formatDate(purchaseStats.latestIntakeOn)}, ${formatQuantity(purchaseStats.latestIntakeQuantity)}${product.unit_label}`
              : "아직 없음"}
          />
          {product.active_months ? (
            <>
              <InfoRow
                label="사용 시기"
                value={formatActiveMonths(product)}
              />
              <InfoRow
                label="연평균 월 환산량"
                value={formatAnnualizedMonthlyAmount(consumptionStats, product.unit_label)}
              />
              <InfoRow
                label="사용 월 평균 소비량"
                value={formatConsumptionAmount(consumptionStats, product.unit_label)}
              />
            </>
          ) : (
            <InfoRow
              label="월평균 소비량"
              value={formatConsumptionAmount(consumptionStats, product.unit_label)}
            />
          )}
          <InfoRow
            label="1년 예상 필요량"
            value={formatConsumptionTotal(
              consumptionStats.annualAmount,
              consumptionStats.annualPackageCount,
              consumptionStats.monthlyUnit,
              product.unit_label
            )}
          />
          {consumptionStats.nextSeasonStartOn && consumptionStats.nextSeasonEndOn ? (
            <InfoRow
              label="사용 시즌 예상량"
              value={`${formatDate(consumptionStats.nextSeasonStartOn)}–${formatDate(consumptionStats.nextSeasonEndOn)}, ${formatConsumptionTotal(
                consumptionStats.nextSeasonAmount,
                consumptionStats.nextSeasonPackageCount,
                consumptionStats.monthlyUnit,
                product.unit_label
              )}`}
            />
          ) : null}
          {product.next_sale_on && product.purchase_coverage_months ? (
            <InfoRow
              label="다음 세일 구매 추천"
              value={consumptionStats.recommendedPurchaseQuantity === null
                ? `${formatDate(product.next_sale_on)}, 소비량을 계산한 뒤 추천`
                : `${formatDate(product.next_sale_on)}, ${product.purchase_coverage_months}개월치 ${consumptionStats.recommendedPurchaseQuantity}${product.unit_label}`}
            />
          ) : null}
          <InfoRow
            label="구매 간격 (참고)"
            value={purchaseStats.medianIntervalDays === null
              ? "서로 다른 실제 구매일 2개부터 계산"
              : `${formatApproxDays(purchaseStats.medianIntervalDays)} (${purchaseStats.intervalSampleCount}개 간격 기준)`}
          />
        </dl>
        {consumptionStats.source === "purchase" ? (
          <p className="forecast-method-note">
            현재 재고 추적을 시작하기 전 구매 기록은 모두 사용한 것으로 보고 계산했습니다.
            {consumptionStats.inferredSizeRecordCount > 0
              ? ` 용량이 비어 있던 ${consumptionStats.inferredSizeRecordCount}건은 현재 제품 용량을 적용했습니다.`
              : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function PurchaseRecords({
  product,
  purchases,
  purchaseStats,
  storeById,
  busy,
  onAdd,
  onViewAll,
  onEdit
}: {
  product: InventoryProduct;
  purchases: InventoryPurchase[];
  purchaseStats: PurchaseStats;
  storeById: Map<string, string>;
  busy: boolean;
  onAdd: () => void;
  onViewAll: () => void;
  onEdit: (purchase: InventoryPurchase) => void;
}) {
  const recentPurchases = purchases.slice(0, 3);
  return (
    <section className="records-panel" role="tabpanel">
      <div className="records-summary">
        <strong>구매 {purchases.length}건 (총 {formatQuantity(purchaseStats.totalPackageCount)}{product.unit_label})</strong>
        {purchaseStats.firstPurchasedOn && purchaseStats.lastPurchasedOn ? (
          <span>{formatHistoryRange(purchaseStats.firstPurchasedOn, purchaseStats.lastPurchasedOn)}</span>
        ) : null}
      </div>
      {recentPurchases.length ? (
        <ul className="evidence-list">
          {recentPurchases.map((purchase) => {
            const storeName = storeById.get(purchase.store_id) || "쇼핑몰 미확인";
            return (
              <li key={purchase.id}>
                <button type="button" disabled={busy} onClick={() => onEdit(purchase)}>
                  <span className="purchase-evidence-line">
                    {formatDate(purchase.purchased_on)}, {formatQuantity(purchase.package_count)}{product.unit_label} <small>({storeName})</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="history-empty">입력한 과거 구매 기록이 없습니다.</p>}
      <div className="records-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={onAdd}>구매 기록 추가</button>
        {purchases.length ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={onViewAll}>전체 {purchases.length}건 보기</button>
        ) : null}
      </div>
    </section>
  );
}

function InventoryRecords({
  product,
  events,
  busy,
  onViewAll,
  onEdit
}: {
  product: InventoryProduct;
  events: InventoryEvent[];
  busy: boolean;
  onViewAll: () => void;
  onEdit: (event: InventoryEvent) => void;
}) {
  return (
    <section className="records-panel" role="tabpanel">
      <div className="records-summary"><strong>재고 {events.length}건</strong></div>
      {events.length ? (
        <ul className="evidence-list">
          {events.slice(0, 5).map((event) => {
            const editable = event.event_type === "intake" || event.event_type === "use";
            const content = <span>{formatDate(event.occurred_on)}, {eventLabel(event, product.unit_label)}</span>;
            return (
              <li key={event.id}>
                {editable ? (
                  <button type="button" disabled={busy} onClick={() => onEdit(event)}>
                    {content}<small>(수정 가능)</small>
                  </button>
                ) : <div className="evidence-static">{content}</div>}
              </li>
            );
          })}
        </ul>
      ) : <p className="history-empty">아직 재고 기록이 없습니다.</p>}
      {events.length ? (
        <div className="records-actions one-column">
          <button type="button" className="secondary-button" disabled={busy} onClick={onViewAll}>전체 {events.length}건 보기</button>
        </div>
      ) : null}
    </section>
  );
}

function UsageRecords({
  product,
  cycles,
  busy,
  onEdit
}: {
  product: InventoryProduct;
  cycles: UsageCycle[];
  busy: boolean;
  onEdit: (cycle: UsageCycle) => void;
}) {
  return (
    <section className="records-panel" role="tabpanel">
      <div className="records-summary"><strong>사용 {cycles.length}건</strong></div>
      {product.tracking_mode !== "cycle" ? (
        <p className="history-empty">수량형 제품은 재고 탭의 사용 기록을 기준으로 계산합니다.</p>
      ) : cycles.length ? (
        <ul className="evidence-list">
          {cycles.map((cycle) => (
            <li key={cycle.id}>
              <button type="button" disabled={busy} onClick={() => onEdit(cycle)}>
                <span>{formatDate(cycle.opened_on)}–{formatDate(cycle.finished_on)}, {cycle.duration_days}일</span>
                <small>({cycle.consumer_count}명 사용)</small>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="history-empty">아직 완료된 사용 주기가 없습니다.</p>}
    </section>
  );
}

function RecordTab({
  active,
  label,
  count,
  onClick
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      {label} {count}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function sortByDateAndCreatedAt(a: InventoryEvent, b: InventoryEvent): number {
  return b.occurred_on.localeCompare(a.occurred_on)
    || b.created_at.localeCompare(a.created_at)
    || b.id.localeCompare(a.id);
}
