import {
  eventLabel,
  formatApproxDays,
  formatDate,
  formatQuantity
} from "../lib/inventory";
import type {
  InventoryAction,
  InventoryEvent,
  InventoryProduct,
  ProductEstimate,
  UsageCycle
} from "../types";
import { ChevronIcon } from "./Icons";

interface ProductCardProps {
  product: InventoryProduct;
  estimate: ProductEstimate;
  events: InventoryEvent[];
  cycles: UsageCycle[];
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onAction: (action: InventoryAction) => void;
  onEdit: () => void;
}

export function ProductCard({
  product,
  estimate,
  events,
  cycles,
  expanded,
  busy,
  onToggle,
  onAction,
  onEdit
}: ProductCardProps) {
  const productEvents = events
    .filter((event) => event.product_id === product.id)
    .slice(0, 5);
  const productCycles = cycles
    .filter((cycle) => cycle.product_id === product.id)
    .slice(0, 3);
  const isCycle = product.tracking_mode === "cycle";
  const currentMeta = `${formatQuantity(product.current_quantity)}${product.unit_label}`;

  return (
    <article className={`product-card${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="product-summary"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={`status-dot ${estimate.isUrgent ? "urgent" : "okay"}`}
          aria-label={estimate.isUrgent ? "구매 필요" : "재고 여유"}
        />
        <span className="product-summary-copy">
          <strong>{product.name}</strong>
          <span className="product-summary-meta">
            현재 {currentMeta}
            {product.active_opened_on ? " · 사용 중" : ""}
          </span>
        </span>
        <ChevronIcon className="product-chevron" />
      </button>

      {expanded ? (
        <div className="product-details">
          <div className={`status-callout ${estimate.isUrgent ? "urgent" : "okay"}`}>
            <strong>{estimate.isUrgent ? "구매할 때가 가까워요" : "현재는 재고가 충분해요"}</strong>
            <span>
              {estimate.isUrgent
                ? estimate.urgentReason
                : estimate.isLearning
                  ? "사용 기록을 쌓는 중입니다. 구매 기준 수량으로 먼저 판단하고 있어요."
                  : estimate.remainingDays !== null
                    ? `현재 사용 속도 기준 ${formatApproxDays(estimate.remainingDays)}분이 남았습니다.`
                    : "설정한 구매 기준보다 재고가 많습니다."}
            </span>
          </div>

          <dl className="product-info">
            <InfoRow label="현재 재고" value={`${currentMeta}${product.active_opened_on ? " · 1개 사용 중" : ""}`} />
            <InfoRow
              label="기록 방식"
              value={isCycle ? "개봉일부터 소진일까지" : "사용할 때 수량 차감"}
            />

            {isCycle ? (
              <>
                <InfoRow
                  label="현재 제품"
                  value={
                    product.active_opened_on
                      ? `${formatDate(product.active_opened_on)} 개봉 · ${product.active_consumer_count || product.current_consumer_count}명 사용`
                      : product.current_quantity > 0
                        ? "아직 개봉 기록 없음"
                        : "사용 중인 제품 없음"
                  }
                />
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
              label="예상 소진"
              value={
                estimate.estimatedOutDate
                  ? `${formatDate(estimate.estimatedOutDate)} · ${formatApproxDays(estimate.remainingDays)}`
                  : "사용 주기 학습 중"
              }
            />
            <InfoRow
              label="구매 기준"
              value={`${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하 또는 예상 소진 ${product.alert_days}일 전`}
            />
            {product.package_size && product.capacity_unit ? (
              <InfoRow
                label="제품 용량"
                value={`${formatQuantity(product.package_size)}${product.capacity_unit}`}
              />
            ) : null}
            {product.notes ? <InfoRow label="메모" value={product.notes} /> : null}
          </dl>

          <div className="quick-actions" aria-label={`${product.name} 빠른 기록`}>
            <button type="button" disabled={busy} onClick={() => onAction("intake")}>
              <span aria-hidden="true">＋</span>
              입고
            </button>
            {isCycle ? (
              product.active_opened_on ? (
                <button type="button" className="quick-action-main" disabled={busy} onClick={() => onAction("finish")}>
                  다 씀
                </button>
              ) : (
                <button
                  type="button"
                  className="quick-action-main"
                  disabled={busy || product.current_quantity < 1}
                  onClick={() => onAction("open")}
                >
                  새 통 개봉
                </button>
              )
            ) : (
              <button
                type="button"
                className="quick-action-main"
                disabled={busy || product.current_quantity <= 0}
                onClick={() => onAction("use")}
              >
                <span aria-hidden="true">−</span>
                사용
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onAction("adjustment")}>
              재고 정정
            </button>
          </div>

          <section className="history-section">
            <div className="section-heading">
              <h3>최근 기록</h3>
              <button type="button" className="text-button" disabled={busy} onClick={onEdit}>
                제품 설정
              </button>
            </div>
            {productEvents.length ? (
              <ul className="history-list">
                {productEvents.map((event) => (
                  <li key={event.id}>
                    <span>{formatDate(event.occurred_on)}</span>
                    <strong>{eventLabel(event, product.unit_label)}</strong>
                    {event.note ? <small>{event.note}</small> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="history-empty">아직 기록이 없습니다.</p>
            )}
          </section>

          {productCycles.length ? (
            <details className="cycle-history">
              <summary>완료된 사용 주기 {cycles.filter((cycle) => cycle.product_id === product.id).length}회</summary>
              <ul>
                {productCycles.map((cycle) => (
                  <li key={cycle.id}>
                    <span>{formatDate(cycle.opened_on)} → {formatDate(cycle.finished_on)}</span>
                    <strong>{cycle.duration_days}일 · {cycle.consumer_count}명</strong>
                  </li>
                ))}
              </ul>
            </details>
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

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}
