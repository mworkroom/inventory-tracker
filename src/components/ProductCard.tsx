import {
  eventLabel,
  formatApproxDays,
  formatDate,
  formatQuantity,
  getInventoryAttentionKind,
  isRepurchaseDue,
  isStockInitialized
} from "../lib/inventory";
import { getProductStoreIds } from "../lib/inventoryStores";
import type {
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

interface ProductCardProps {
  product: InventoryProduct;
  estimate: ProductEstimate;
  purchaseStats: PurchaseStats;
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
  onPurchaseEdit: (purchase: InventoryPurchase) => void;
  onUsageCycleEdit: (cycle: UsageCycle) => void;
  onEventAmountEdit: (event: InventoryEvent) => void;
}

export function ProductCard({
  product,
  estimate,
  purchaseStats,
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
  onPurchaseEdit,
  onUsageCycleEdit,
  onEventAmountEdit
}: ProductCardProps) {
  const allProductEvents = events.filter(
    (event) => event.product_id === product.id
  );
  const productEvents = allProductEvents.slice(0, 5);
  const latestRecordedEvent = allProductEvents.reduce<InventoryEvent | null>(
    (latest, event) => {
      if (!latest) return event;
      const timeComparison = event.created_at.localeCompare(latest.created_at);
      if (timeComparison !== 0) return timeComparison > 0 ? event : latest;
      return event.id > latest.id ? event : latest;
    },
    null
  );
  const productCycles = cycles
    .filter((cycle) => cycle.product_id === product.id)
    .slice(0, 3);
  const recentPurchases = purchases.slice(0, 5);
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const shoppingMallNames = getProductStoreIds(product)
    .map((storeId) => storeById.get(storeId)?.name || "쇼핑몰 미확인");
  const shoppingMallSummary = shoppingMallNames.join(", ");
  const isCycle = product.tracking_mode === "cycle";
  const stockInitialized = isStockInitialized(product);
  const hasActiveProduct = Boolean(product.active_opened_on);
  const currentMeta = stockInitialized
    ? `${formatQuantity(product.current_quantity)}${product.unit_label}`
    : "재고 미설정";
  const activeMeta = formatActiveMeta(product);
  const inventoryAttentionKind = getInventoryAttentionKind(product, estimate);
  const repurchaseDue = isRepurchaseDue(product, purchaseStats);
  const statusClass = inventoryAttentionKind
    ? "urgent"
    : repurchaseDue
      ? "repurchase"
      : stockInitialized
        ? "okay"
        : "unknown";
  const statusLabel = inventoryAttentionKind === "quantity"
    ? "재고 확인"
    : inventoryAttentionKind === "usage"
      ? "소진 임박"
      : repurchaseDue
        ? "재구매 시기"
        : stockInitialized
          ? "재고 여유"
          : "재고 미설정";
  const statusTitle = inventoryAttentionKind === "quantity"
    ? "현재 재고가 알림 기준에 도달했어요"
    : inventoryAttentionKind === "usage"
      ? "예상 소진 시기가 가까워요"
      : repurchaseDue
        ? "평소 재구매 시기가 가까워요"
        : stockInitialized
          ? "현재 재고는 여유 있어요"
          : "현재 재고를 아직 설정하지 않았어요";
  const statusDescription = inventoryAttentionKind === "quantity"
    ? `현재 재고가 알림 기준 ${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하입니다.`
    : inventoryAttentionKind === "usage" && estimate.remainingDays !== null
      ? `현재 사용 속도라면 약 ${Math.max(0, Math.round(estimate.remainingDays))}일 후 재고가 소진됩니다.`
      : repurchaseDue && purchaseStats.nextPurchaseDate
        ? `${formatPurchaseForecast(purchaseStats.nextPurchaseDate, purchaseStats.daysUntilNextPurchase)} · 과거 구매일과 실제 입고일을 기준으로 한 알림입니다.`
        : stockInitialized
          ? estimate.forecastSource === "usage" && estimate.remainingDays !== null
            ? `현재 사용 속도 기준 약 ${Math.max(0, Math.round(estimate.remainingDays))}일분이 남았습니다.`
            : isCycle
              ? "개봉일과 다 쓴 날 기록을 쌓으면 실제 사용 기간을 계산합니다."
              : "서로 다른 날짜의 사용 기록을 쌓으면 실제 사용 속도를 계산합니다."
          : "첫 입고를 기록하거나 현재 재고를 설정하면 재고 계산을 시작합니다.";

  return (
    <article className={`product-card${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="product-summary"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={`status-dot ${statusClass}`}
          aria-label={statusLabel}
        />
        <span className="product-summary-copy">
          <span className="product-summary-name-row">
            <strong>{product.name}</strong>
          </span>
          <span className="product-summary-meta">
            {stockInitialized ? `현재 ${currentMeta}` : currentMeta}
            {hasActiveProduct ? " · 사용 중" : ""}
          </span>
        </span>
        <ChevronIcon className="product-chevron" />
      </button>

      {expanded ? (
        <div className="product-details">
          <div className={`status-callout ${statusClass}`}>
            <strong>{statusTitle}</strong>
            <span>{statusDescription}</span>
          </div>

          <dl className="product-info">
            <InfoRow label="카테고리" value={product.category || "미분류"} />
            <InfoRow label="쇼핑몰" value={shoppingMallSummary || "미지정"} />
            <InfoRow
              label="현재 재고"
              value={stockInitialized
                ? `${currentMeta}${hasActiveProduct ? " · 사용 중 제품 포함" : ""}`
                : "미설정 · 첫 입고 또는 현재 재고 설정 필요"}
            />
            {isCycle && product.package_size && product.capacity_unit ? (
              <InfoRow
                label="제품 1개 용량"
                value={`${formatQuantity(product.package_size)}${product.capacity_unit}`}
              />
            ) : null}
            <InfoRow label="기록 방식" value={trackingModeLabel(product)} />
            {product.notes ? <InfoRow label="메모" value={product.notes} /> : null}
          </dl>

          <section className="forecast-section stock-forecast-section">
            <div className="forecast-section-heading">
              <div>
                <h3>재고·사용 기준</h3>
                <p>현재 재고와 실제 사용 기록으로 소진 시기를 봅니다.</p>
              </div>
              <span className={`forecast-status ${inventoryAttentionKind ? "urgent" : "neutral"}`}>
                {inventoryAttentionKind === "quantity"
                  ? "재고 확인"
                  : inventoryAttentionKind === "usage"
                    ? "소진 임박"
                    : estimate.forecastSource === "usage"
                      ? "소진일 계산됨"
                      : "사용 기록 학습 중"}
              </span>
            </div>
            <dl className="product-info forecast-info">
              {isCycle ? (
                <>
                  <InfoRow label="현재 제품" value={activeMeta} />
                  <InfoRow
                    label="학습한 사용 주기"
                    value={
                      estimate.expectedCycleDays === null
                        ? "첫 소진 기록을 기다리는 중"
                        : `${formatApproxDays(estimate.expectedCycleDays)} · 최근 ${estimate.cycleSampleCount}회 기준`
                    }
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
                  value={
                    estimate.daysPerUnit === null
                      ? "서로 다른 날짜의 사용 기록 2개가 필요함"
                      : `${formatApproxDays(estimate.daysPerUnit)}에 1${product.unit_label} · 최근 ${estimate.useSampleCount}일 기록 기준`
                  }
                />
              )}
              <InfoRow
                label="예상 소진 시기"
                value={
                  estimate.forecastSource === "usage" && estimate.estimatedOutDate
                    ? `${formatDate(estimate.estimatedOutDate)} · ${formatApproxDays(estimate.remainingDays)}`
                    : stockInitialized
                      ? isCycle
                        ? "완료된 사용 주기를 기록하면 계산"
                        : "서로 다른 날짜의 사용 기록 2개부터 계산"
                      : "현재 재고 설정 후 계산"
                }
              />
              <InfoRow
                label="재고 알림 기준"
                value={`${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하 또는 예상 소진 ${product.alert_days}일 전`}
              />
            </dl>
          </section>

          <section className="forecast-section purchase-forecast-section">
            <div className="forecast-section-heading">
              <div>
                <h3>재구매 간격 기준</h3>
                <p>과거 구매일과 앞으로의 입고일을 함께 봅니다.</p>
              </div>
              <span className={`forecast-status ${repurchaseDue ? "repurchase" : "neutral"}`}>
                {repurchaseDue
                  ? "재구매 시기"
                  : purchaseStats.nextPurchaseDate
                    ? "예상일 있음"
                    : "재구매 간격 학습 전"}
              </span>
            </div>
            <dl className="product-info forecast-info">
              <InfoRow
                label="기준 날짜"
                value={
                  purchaseStats.purchaseDateCount > 0
                    ? `${purchaseStats.purchaseDateCount}개 · 최근 ${formatDate(purchaseStats.lastPurchasedOn)}`
                    : "아직 없음"
                }
              />
              <InfoRow
                label="재구매 간격"
                value={
                  purchaseStats.medianIntervalDays === null
                    ? purchaseStats.purchaseDateCount > 0
                      ? "날짜가 2개 이상 필요함"
                      : "과거 구매일을 입력하거나 입고하면 계산"
                    : `${formatApproxDays(purchaseStats.medianIntervalDays)} · 간격 ${purchaseStats.intervalSampleCount}개 기준`
                }
              />
              <InfoRow
                label="재구매 예상일"
                value={
                  purchaseStats.nextPurchaseDate
                    ? formatPurchaseForecast(
                        purchaseStats.nextPurchaseDate,
                        purchaseStats.daysUntilNextPurchase
                      )
                    : "과거 구매일·입고일 합계 2개부터 계산"
                }
              />
            </dl>
          </section>

          <div className={`quick-actions ${isCycle ? "cycle-actions" : "count-actions"}`} aria-label={`${product.name} 빠른 기록`}>
            <button type="button" disabled={busy} onClick={() => onAction("intake")}>
              <span aria-hidden="true">＋</span>
              입고
            </button>
            {isCycle ? (
              product.active_opened_on ? (
                <button
                  type="button"
                  className="quick-action-main"
                  disabled={busy}
                  onClick={() => onAction("finish")}
                >
                  다 씀
                </button>
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
                <span aria-hidden="true">−</span>
                사용 기록
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
              <button type="button" disabled={busy} onClick={onActiveUsageEdit}>
                사용 중 수정
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => onAction("adjustment")}>
              {stockInitialized ? "재고 정정" : "현재 재고 설정"}
            </button>
          </div>

          <p className="inventory-action-note">
            {isCycle
              ? stockInitialized
                ? "입고하면 통·병·봉 개수가 늘고, 그 날짜가 재구매 간격에도 반영됩니다. 다 쓰면 현재 제품 1개가 재고에서 빠집니다."
                : "첫 입고부터 재고와 재구매 간격 계산을 시작하거나, 이미 가진 개수만 현재 재고로 설정할 수 있습니다."
              : stockInitialized
                ? "사용량을 알면 사용 기록, 실제 잔량만 알면 지금 남은 수량 확인, 입력 실수는 재고 정정을 사용합니다."
                : "첫 입고를 기록하거나 지금 가진 수량을 현재 재고로 설정하면 계산을 시작합니다."}
          </p>

          <button
            type="button"
            className="historical-purchase-action"
            disabled={busy}
            onClick={onPurchaseHistoryAdd}
          >
            과거 구매일 추가
          </button>
          <p className="purchase-action-note">
            현재 재고와 무관한 과거 날짜만 보충합니다.
          </p>

          <section className="history-section">
            <div className="section-heading">
              <h3>최근 재고 기록</h3>
              <button type="button" className="text-button" disabled={busy} onClick={onEdit}>
                제품 설정
              </button>
            </div>
            {productEvents.length ? (
              <ul className="history-list">
                {productEvents.map((event) => (
                  <li key={event.id}>
                    <span>{formatDate(event.occurred_on)}</span>
                    <div className="history-entry-copy">
                      <strong>
                        {eventLabel(event, product.unit_label)}
                      </strong>
                      {product.tracking_mode === "count" &&
                      latestRecordedEvent?.id === event.id &&
                      (event.event_type === "intake" ||
                        event.event_type === "use") ? (
                        <button
                          type="button"
                          className="history-edit-button"
                          disabled={busy}
                          aria-label={`${formatDate(event.occurred_on)} ${event.event_type === "intake" ? "입고" : "사용"} 기록 수정`}
                          onClick={() => onEventAmountEdit(event)}
                        >
                          수정
                        </button>
                      ) : null}
                    </div>
                    {event.note ? <small>{event.note}</small> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="history-empty">아직 기록이 없습니다.</p>
            )}
          </section>

          <section className="purchase-history-section">
            <div className="section-heading">
              <h3>과거 구매일</h3>
              <span>{purchases.length}개</span>
            </div>
            {recentPurchases.length ? (
              <ul className="purchase-history-list">
                {recentPurchases.map((purchase) => {
                  const storeName = storeById.get(purchase.store_id)?.name || "쇼핑몰 미확인";
                  return (
                    <li key={purchase.id}>
                      <button type="button" disabled={busy} onClick={() => onPurchaseEdit(purchase)}>
                        <span>{formatDate(purchase.purchased_on)}</span>
                        {storeName !== "기타" ? <small>{storeName}</small> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="history-empty">입력한 과거 구매일이 없습니다.</p>
            )}
          </section>

          {isCycle ? (
            <section className="history-section usage-cycle-section">
              <div className="section-heading">
                <h3>사용 주기 기록</h3>
              </div>
              {productCycles.length ? (
                <details className="cycle-history">
                  <summary>
                    완료된 사용 주기 {cycles.filter((cycle) => cycle.product_id === product.id).length}회
                  </summary>
                  <ul>
                    {productCycles.map((cycle) => (
                      <li key={cycle.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onUsageCycleEdit(cycle)}
                        >
                          <span>{formatDate(cycle.opened_on)} → {formatDate(cycle.finished_on)}</span>
                          <strong>{cycle.duration_days}일 · {cycle.consumer_count}명</strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="history-empty">아직 완료된 사용 주기가 없습니다.</p>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
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

function trackingModeLabel(product: InventoryProduct): string {
  switch (product.tracking_mode) {
    case "cycle":
      return `개봉일과 다 쓴 날만 기록 (${product.unit_label})`;
    case "count":
    default:
      return `쓸 때마다 수량 줄이기 (${product.unit_label})`;
  }
}

function formatActiveMeta(product: InventoryProduct): string {
  if (!isStockInitialized(product)) return "현재 재고를 설정하면 개봉 기록을 시작할 수 있음";

  if (product.active_opened_on) {
    return `${formatDate(product.active_opened_on)} 개봉 · ${product.active_consumer_count || product.current_consumer_count}명 사용`;
  }
  return product.current_quantity > 0
    ? "아직 개봉한 제품 없음"
    : "사용 중인 제품 없음";
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function formatPurchaseForecast(
  date: string,
  daysUntil: number | null
): string {
  if (daysUntil === null) return formatDate(date);
  if (daysUntil < 0) return `${formatDate(date)} · 예상일에서 ${Math.abs(daysUntil)}일 지남`;
  if (daysUntil === 0) return `${formatDate(date)} · 오늘`;
  return `${formatDate(date)} · ${daysUntil}일 후`;
}
