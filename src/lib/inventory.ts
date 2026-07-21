import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  ProductEstimate,
  PurchaseStats,
  UsageCycle
} from "../types";

const DAY_MS = 86_400_000;

export function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function estimateProduct(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  today = todayIso()
): ProductEstimate {
  const productEvents = events.filter((event) => event.product_id === product.id);
  const productCycles = cycles.filter((cycle) => cycle.product_id === product.id);

  const base =
    product.tracking_mode === "cycle"
      ? estimateCycleProduct(product, productCycles, today)
      : estimateDecrementProduct(product, productEvents, today);

  const quantityUrgent = product.current_quantity <= product.low_stock_threshold;
  const daysUrgent =
    base.remainingDays !== null && base.remainingDays <= product.alert_days;
  const isUrgent = quantityUrgent || daysUrgent;

  let urgentReason: string | null = null;
  if (quantityUrgent) {
    urgentReason = `현재 재고가 구매 기준 ${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하입니다.`;
  } else if (daysUrgent && base.remainingDays !== null) {
    urgentReason = `현재 사용 속도라면 약 ${Math.max(0, Math.round(base.remainingDays))}일 후 재고가 소진됩니다.`;
  }

  return {
    ...base,
    isUrgent,
    urgentReason
  };
}

function estimateCycleProduct(
  product: InventoryProduct,
  cycles: UsageCycle[],
  today: string
): ProductEstimate {
  const recentCycles = [...cycles]
    .sort((a, b) => compareIsoDate(b.finished_on, a.finished_on))
    .slice(0, 5);
  const currentPeople = Math.max(1, product.current_consumer_count || 1);

  const adjustedDurations = recentCycles.map((cycle) => {
    const historicalPeople = Math.max(1, cycle.consumer_count || 1);
    const capacityRatio =
      product.package_size &&
      cycle.package_size &&
      product.capacity_unit &&
      product.capacity_unit === cycle.capacity_unit
        ? product.package_size / cycle.package_size
        : 1;

    return cycle.duration_days * historicalPeople * capacityRatio / currentPeople;
  });

  const expectedCycleDays = median(adjustedDurations);
  let remainingDays: number | null = null;

  if (expectedCycleDays !== null && expectedCycleDays > 0) {
    const hasActiveProduct = Boolean(
      product.active_opened_on || product.active_remaining_quantity !== null
    );
    const unopenedUnits = Math.max(
      0,
      product.current_quantity - (hasActiveProduct ? 1 : 0)
    );
    let activeRemainingDays = 0;

    if (hasActiveProduct) {
      if (
        product.package_size &&
        product.package_size > 0 &&
        product.active_remaining_quantity !== null
      ) {
        const dailyCapacity = product.package_size / expectedCycleDays;
        const measuredOn =
          product.active_remaining_updated_on || product.active_opened_on || today;
        const elapsedSinceMeasurement = Math.max(0, daysBetween(measuredOn, today));
        const estimatedRemainingCapacity = Math.max(
          0,
          product.active_remaining_quantity - elapsedSinceMeasurement * dailyCapacity
        );
        activeRemainingDays = estimatedRemainingCapacity / dailyCapacity;
      } else if (product.active_opened_on) {
        const elapsedDays = Math.max(
          0,
          daysBetween(product.active_opened_on, today)
        );
        activeRemainingDays = Math.max(0, expectedCycleDays - elapsedDays);
      } else {
        activeRemainingDays = expectedCycleDays;
      }
    }

    remainingDays = activeRemainingDays + unopenedUnits * expectedCycleDays;
    if (!hasActiveProduct) {
      remainingDays = product.current_quantity * expectedCycleDays;
    }
  }

  const estimatedOutDate =
    remainingDays === null
      ? null
      : addDays(today, Math.max(0, Math.ceil(remainingDays)));

  const perPersonDailyCapacity =
    product.package_size && expectedCycleDays
      ? product.package_size / (expectedCycleDays * currentPeople)
      : null;

  return {
    isUrgent: false,
    urgentReason: null,
    isLearning: recentCycles.length === 0,
    remainingDays,
    estimatedOutDate,
    expectedCycleDays,
    daysPerUnit: expectedCycleDays,
    perPersonDailyCapacity,
    cycleSampleCount: recentCycles.length,
    useSampleCount: 0
  };
}

function estimateDecrementProduct(
  product: InventoryProduct,
  events: InventoryEvent[],
  today: string
): ProductEstimate {
  const dailyUse = new Map<string, number>();

  events
    .filter((event) => event.event_type === "use" && event.quantity_delta < 0)
    .forEach((event) => {
      dailyUse.set(
        event.occurred_on,
        (dailyUse.get(event.occurred_on) || 0) + Math.abs(event.quantity_delta)
      );
    });

  const samples = [...dailyUse.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => compareIsoDate(a.date, b.date))
    .slice(-8);

  let daysPerUnit: number | null = null;
  if (samples.length >= 2) {
    const intervals: number[] = [];
    for (let index = 1; index < samples.length; index += 1) {
      const interval = daysBetween(samples[index - 1].date, samples[index].date);
      if (interval > 0) intervals.push(interval);
    }

    const typicalInterval = median(intervals);
    const typicalAmount = median(samples.map((sample) => sample.amount));
    if (typicalInterval !== null && typicalAmount && typicalAmount > 0) {
      daysPerUnit = typicalInterval / typicalAmount;
    }
  }

  const remainingDays =
    daysPerUnit === null
      ? null
      : Math.max(0, product.current_quantity * daysPerUnit);
  const estimatedOutDate =
    remainingDays === null
      ? null
      : addDays(today, Math.max(0, Math.ceil(remainingDays)));

  return {
    isUrgent: false,
    urgentReason: null,
    isLearning: samples.length < 2,
    remainingDays,
    estimatedOutDate,
    expectedCycleDays: null,
    daysPerUnit,
    perPersonDailyCapacity: null,
    cycleSampleCount: 0,
    useSampleCount: samples.length
  };
}

export function calculatePurchaseStats(
  productId: string,
  purchases: InventoryPurchase[],
  today = todayIso()
): PurchaseStats {
  const productPurchases = purchases.filter(
    (purchase) => purchase.product_id === productId
  );
  const uniqueDates = [
    ...new Set(productPurchases.map((purchase) => purchase.purchased_on))
  ].sort(compareIsoDate);
  const intervals: number[] = [];

  for (let index = 1; index < uniqueDates.length; index += 1) {
    const interval = daysBetween(uniqueDates[index - 1], uniqueDates[index]);
    if (interval > 0) intervals.push(interval);
  }

  const recentIntervals = intervals.slice(-7);
  const medianIntervalDays = median(recentIntervals);
  const lastPurchasedOn = uniqueDates.at(-1) ?? null;
  const nextPurchaseDate =
    lastPurchasedOn && medianIntervalDays !== null
      ? addDays(lastPurchasedOn, Math.round(medianIntervalDays))
      : null;

  return {
    purchaseCount: productPurchases.length,
    purchaseDateCount: uniqueDates.length,
    intervalSampleCount: recentIntervals.length,
    medianIntervalDays,
    lastPurchasedOn,
    nextPurchaseDate,
    daysUntilNextPurchase:
      nextPurchaseDate === null ? null : daysBetween(today, nextPurchaseDate)
  };
}

export function parsePurchaseDates(
  input: string,
  maxDate = todayIso()
): string[] {
  const lines = input
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("구매 날짜를 한 줄에 하나씩 입력해주세요.");
  }

  const invalidLines: string[] = [];
  const normalizedDates: string[] = [];

  for (const line of lines) {
    const normalized = normalizePurchaseDate(line);
    if (!normalized || normalized > maxDate) {
      invalidLines.push(line);
      continue;
    }
    normalizedDates.push(normalized);
  }

  if (invalidLines.length > 0) {
    const preview = invalidLines.slice(0, 3).join(", ");
    throw new Error(`날짜 형식을 확인해주세요: ${preview}`);
  }

  return [...new Set(normalizedDates)].sort(compareIsoDate);
}

function normalizePurchaseDate(value: string): string | null {
  const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  const koreanMatch = value.match(
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*\.?$/
  );
  const separatedMatch = value.match(
    /^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*\.?$/
  );
  const match = compactMatch || koreanMatch || separatedMatch;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function median(values: number[]): number | null {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const middle = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) return valid[middle];
  return (valid[middle - 1] + valid[middle]) / 2;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((isoToUtcMs(toIso) - isoToUtcMs(fromIso)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(isoToUtcMs(iso) + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(year, month - 1, day));
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 3
  }).format(value);
}

export function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0
  }).format(value)}원`;
}

export function formatApproxDays(value: number | null): string {
  if (value === null) return "학습 중";
  const days = Math.max(0, Math.round(value));
  if (days < 60) return `약 ${days}일`;
  const months = days / 30.4375;
  if (months < 12) {
    return `약 ${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 1
    }).format(months)}개월`;
  }
  const years = months / 12;
  return `약 ${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1
  }).format(years)}년`;
}

export function eventLabel(
  event: InventoryEvent,
  unitLabel: string,
  capacityUnit?: string | null
): string {
  const amount = formatQuantity(Math.abs(event.quantity_delta));
  switch (event.event_type) {
    case "intake":
      return `${amount}${unitLabel} 입고`;
    case "use":
      return `${amount}${unitLabel} 사용`;
    case "open":
      return `새 제품 개봉${event.consumer_count ? ` · ${event.consumer_count}명` : ""}`;
    case "finish":
      return `다 씀${event.consumer_count ? ` · ${event.consumer_count}명` : ""}`;
    case "remainder":
      return `현재 제품 잔량 ${event.note || (capacityUnit ? `정정 (${capacityUnit})` : "정정")}`;
    case "adjustment":
      return `재고 ${formatQuantity(event.quantity_after)}${unitLabel}로 정정`;
  }
}

export function actionPastTense(action: string): string {
  switch (action) {
    case "intake":
      return "입고를";
    case "use":
      return "사용을";
    case "open":
      return "개봉을";
    case "finish":
      return "소진을";
    case "remainder":
      return "현재 잔량을";
    case "adjustment":
      return "재고 정정을";
    default:
      return "기록을";
  }
}

function isoToUtcMs(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}
