import type {
  InventoryEvent,
  InventoryProduct,
  ProductEstimate,
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
      : estimateCountProduct(product, productEvents, today);

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

  if (expectedCycleDays !== null) {
    const activeUnits = product.active_opened_on ? 1 : 0;
    const unopenedUnits = Math.max(0, product.current_quantity - activeUnits);
    let activeRemaining = 0;

    if (product.active_opened_on) {
      const elapsedDays = Math.max(1, daysBetween(product.active_opened_on, today) + 1);
      activeRemaining = Math.max(0, expectedCycleDays - elapsedDays);
    }

    remainingDays = activeRemaining + unopenedUnits * expectedCycleDays;
    if (!product.active_opened_on) {
      remainingDays = product.current_quantity * expectedCycleDays;
    }
  }

  const estimatedOutDate =
    remainingDays === null ? null : addDays(today, Math.max(0, Math.ceil(remainingDays)));

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

function estimateCountProduct(
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
    daysPerUnit === null ? null : Math.max(0, product.current_quantity * daysPerUnit);
  const estimatedOutDate =
    remainingDays === null ? null : addDays(today, Math.max(0, Math.ceil(remainingDays)));

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

export function formatApproxDays(value: number | null): string {
  if (value === null) return "학습 중";
  const days = Math.max(0, Math.round(value));
  if (days < 60) return `약 ${days}일`;
  const months = days / 30.4375;
  if (months < 12) {
    return `약 ${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(months)}개월`;
  }
  const years = months / 12;
  return `약 ${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(years)}년`;
}

export function eventLabel(event: InventoryEvent, unitLabel: string): string {
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
