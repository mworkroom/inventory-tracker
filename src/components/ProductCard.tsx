import {
  eventLabel,
  formatApproxDays,
  formatCurrency,
  formatDate,
  formatQuantity,
  isStockInitialized
} from "../lib/inventory";
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
  onEdit: () => void;
  onPurchaseAdd: () => void;
  onPurchaseBulk: () => void;
  onPurchaseEdit: (purchase: InventoryPurchase) => void;
  onUsageCycleAdd: () => void;
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
  onEdit,
  onPurchaseAdd,
  onPurchaseBulk,
  onPurchaseEdit,
  onUsageCycleAdd
}: ProductCardProps) {
  const productEvents = events
    .filter((event) => event.product_id === product.id)
    .slice(0, 5);
  const productCycles = cycles
    .filter((cycle) => cycle.product_id === product.id)
    .slice(0, 3);
  const recentPurchases = purchases.slice(0, 5);
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const preferredStoreName = product.preferred_store_id
    ? storeById.get(product.preferred_store_id)?.name || "구매처 미확인"
    : null;
  const isCycle = product.tracking_mode === "cycle";
  const stockInitialized = isStockInitialized(product);
  const hasActiveProduct = Boolean(
    product.active_opened_on || product.active_remaining_quantity !== null
  );
  const currentMeta = stockInitialized
    ? `${formatQuantity(product.current_quantity)}${product.unit_label}`
    : "재고 미설정";
  const activeMeta = formatActiveMeta(product);
  const statusClass = estimate.isUrgent
    ? "urgent"
    : stockInitialized
      ? "okay"
      : "unknown";
  const statusLabel = estimate.isUrgent
    ? "구매 필요"
    : stockInitialized
      ? "재고 여유"
      : "재고 미설정";

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
          <strong>{product.name}</strong>
          <span className="product-summary-meta">
            {stockInitialized ? `현재 ${currentMeta}` : currentMeta}
            {hasActiveProduct ? " · 사용 중" : ""}
            {preferredStoreName ? ` · ${preferredStoreName}` : ""}
          </span>
        </span>
        <ChevronIcon className="product-chevron" />
      </button>

      {expanded ? (
        <div className="product-details">
          <div className={`status-callout ${statusClass}`}>
            <strong>
              {estimate.isUrgent
                ? "구매할 때가 가까워요"
                : stockInitialized
                  ? "현재는 재고가 충분해요"
                  : "현재 재고를 아직 설정하지 않았어요"}
            </strong>
            <span>
              {estimate.isUrgent
                ? estimate.urgentReason
                : !stockInitialized
                  ? purchaseStats.nextPurchaseDate
                    ? `과거 구매 기록 기준 다음 구매 예상은 ${formatDate(purchaseStats.nextPurchaseDate)}입니다. 첫 입고를 기록하거나 현재 재고를 설정하면 재고 알림도 시작됩니다.`
                    : "과거 구매 기록은 지금 입력할 수 있습니다. 첫 입고를 기록하거나 현재 재고를 설정하면 재고 계산을 시작합니다."
                : estimate.forecastSource === "purchase" && estimate.estimatedOutDate
                  ? `사용 기록이 부족해 과거 구매 기록 기준 ${formatDate(estimate.estimatedOutDate)}을 임시로 참고하고 있습니다.`
                : estimate.isLearning
                  ? isCycle
                    ? "개봉·소진 기록을 쌓는 중입니다. 구매 기준 개수로 먼저 판단하고 있어요."
                    : "사용 기록을 쌓는 중입니다. 구매 기준 수량으로 먼저 판단하고 있어요."
                  : estimate.remainingDays !== null
                    ? `현재 사용 속도 기준 ${formatApproxDays(estimate.remainingDays)}분이 남았습니다.`
                    : "설정한 구매 기준보다 재고가 많습니다."}
            </span>
          </div>

          <dl className="product-info">
            <InfoRow
              label="현재 재고"
              value={stockInitialized
                ? `${currentMeta}${hasActiveProduct ? " · 사용 중 제품 포함" : ""}`
                : "미설정 · 첫 입고 또는 현재 재고 설정 필요"}
            />
            <InfoRow label="기록 방식" value={trackingModeLabel(product)} />

            {isCycle ? (
              <>
                <InfoRow label="현재 제품" value={activeMeta} />
                <InfoRow
                  label="학습한 주기"
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
                {product.package_size && product.capacity_unit ? (
                  <InfoRow
                    label="제품 1개 용량"
                    value={`${formatQuantity(product.package_size)}${product.capacity_unit}`}
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
              label={estimate.forecastSource === "purchase" ? "임시 구매 예상" : "예상 소진"}
              value={
                estimate.estimatedOutDate
                  ? `${formatDate(estimate.estimatedOutDate)} · ${formatApproxDays(estimate.remainingDays)}${estimate.forecastSource === "purchase" ? " · 구매 기록 기준" : ""}`
                  : stockInitialized
                    ? "사용 주기 학습 중"
                    : "현재 재고 설정 후 계산"
              }
            />
            <InfoRow
              label="구매 기준"
              value={`${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하 또는 예상 소진 ${product.alert_days}일 전`}
            />
            <InfoRow label="주구매처" value={preferredStoreName || "미지정"} />
            <InfoRow
              label="구매 기록"
              value={
                purchaseStats.purchaseCount > 0
                  ? `${purchaseStats.purchaseCount}회 · 최근 ${formatDate(purchaseStats.lastPurchasedOn)}`
                  : "아직 없음"
              }
            />
            <InfoRow
              label="평소 구매 간격"
              value={
                purchaseStats.medianIntervalDays === null
                  ? purchaseStats.purchaseDateCount > 0
                    ? "날짜가 2개 이상 필요함"
                    : "과거 기록을 입력하면 계산"
                  : `${formatApproxDays(purchaseStats.medianIntervalDays)} · 간격 ${purchaseStats.intervalSampleCount}개 기준`
              }
            />
            {purchaseStats.nextPurchaseDate ? (
              <InfoRow
                label="다음 구매 예상"
                value={formatPurchaseForecast(
                  purchaseStats.nextPurchaseDate,
                  purchaseStats.daysUntilNextPurchase
                )}
              />
            ) : null}
            {product.notes ? <InfoRow label="메모" value={product.notes} /> : null}
          </dl>

          <div className={`quick-actions${isCycle ? " cycle-actions" : ""}`} aria-label={`${product.name} 빠른 기록`}>
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
                  {product.active_remaining_quantity !== null
                    ? "개봉 정보 입력"
                    : "새 제품 개봉"}
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
                사용
              </button>
            )}
            {isCycle && product.active_opened_on ? (
              <button type="button" disabled={busy} onClick={() => onAction("remainder")}>
                현재 잔량
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => onAction("adjustment")}>
              {stockInitialized ? "재고 정정" : "현재 재고 설정"}
            </button>
          </div>

          {isCycle ? (
            <p className="cycle-action-note">
              {stockInitialized
                ? "입고는 통·병·봉 개수만 늘립니다. 다 쓰면 현재 제품 1개가 재고에서 빠집니다."
                : "첫 입고부터 계산을 시작하거나, 이미 가진 통·병·봉 개수를 먼저 설정할 수 있습니다."}
            </p>
          ) : null}

          <div className="purchase-actions" aria-label={`${product.name} 구매 기록`}>
            <button type="button" className="purchase-action-main" disabled={busy} onClick={onPurchaseAdd}>
              구매 기록
            </button>
            <button type="button" disabled={busy} onClick={onPurchaseBulk}>
              과거 기록 한꺼번에
            </button>
          </div>
          <p className="purchase-action-note">구매 기록은 현재 재고를 바꾸지 않습니다.</p>

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
                    <strong>
                      {eventLabel(event, product.unit_label, product.capacity_unit)}
                    </strong>
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
              <h3>최근 구매 기록</h3>
              <span>{purchaseStats.purchaseCount}회</span>
            </div>
            {recentPurchases.length ? (
              <ul className="purchase-history-list">
                {recentPurchases.map((purchase) => {
                  const storeName = storeById.get(purchase.store_id)?.name || "구매처 미확인";
                  return (
                    <li key={purchase.id}>
                      <button type="button" disabled={busy} onClick={() => onPurchaseEdit(purchase)}>
                        <span>{formatDate(purchase.purchased_on)} · {storeName}</span>
                        <strong>{formatPurchaseAmount(purchase, product)}</strong>
                        {purchase.total_price !== null || purchase.shipping_fee !== null ? (
                          <small>
                            {purchase.total_price !== null ? `총 ${formatCurrency(purchase.total_price)}` : ""}
                            {purchase.shipping_fee !== null
                              ? `${purchase.total_price !== null ? " · " : ""}배송비 ${formatCurrency(purchase.shipping_fee)}`
                              : ""}
                          </small>
                        ) : null}
                        {purchase.note ? <em>{purchase.note}</em> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="history-empty">아직 구매 기록이 없습니다.</p>
            )}
          </section>

          {isCycle ? (
            <section className="history-section usage-cycle-section">
              <div className="section-heading">
                <h3>사용 주기 기록</h3>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={onUsageCycleAdd}
                >
                  과거 기록 추가
                </button>
              </div>
              {productCycles.length ? (
                <details className="cycle-history">
                  <summary>
                    완료된 사용 주기 {cycles.filter((cycle) => cycle.product_id === product.id).length}회
                  </summary>
                  <ul>
                    {productCycles.map((cycle) => (
                      <li key={cycle.id}>
                        <span>{formatDate(cycle.opened_on)} → {formatDate(cycle.finished_on)}</span>
                        <strong>{cycle.duration_days}일 · {cycle.consumer_count}명</strong>
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
      return `개수 재고 + 개봉·소진 (${product.unit_label})`;
    case "count":
    default:
      return `개수 직접 차감 (${product.unit_label})`;
  }
}

function formatActiveMeta(product: InventoryProduct): string {
  if (!isStockInitialized(product)) return "현재 재고를 설정하면 개봉 기록을 시작할 수 있음";

  const remaining =
    product.active_remaining_quantity !== null && product.capacity_unit
      ? ` · 약 ${formatQuantity(product.active_remaining_quantity)}${product.capacity_unit} 남음`
      : "";

  if (product.active_opened_on) {
    return `${formatDate(product.active_opened_on)} 개봉 · ${product.active_consumer_count || product.current_consumer_count}명 사용${remaining}`;
  }
  if (product.active_remaining_quantity !== null) {
    return `현재 잔량${remaining} · 개봉일 미입력`;
  }
  return product.current_quantity > 0
    ? "아직 개봉한 제품 없음"
    : "사용 중인 제품 없음";
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function formatPurchaseAmount(
  purchase: InventoryPurchase,
  product: InventoryProduct
): string {
  const count = `${formatQuantity(purchase.package_count)}${product.unit_label}`;
  if (purchase.package_size === null || !purchase.package_unit) return count;
  return `${count} · ${formatQuantity(purchase.package_size)}${purchase.package_unit}씩`;
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
