import type {
  ConsumptionStats,
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  ProductEstimate,
  PurchaseStats,
  UsageCycle
} from "../types";

const DAY_MS = 86_400_000;
const AVERAGE_DAYS_PER_MONTH = 30.4375;
const AVERAGE_MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const PURCHASE_FORECAST_MIN_RECORDS = 3;
const PURCHASE_FORECAST_MIN_OBSERVATION_DAYS = 180;

export function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isStockInitialized(product: InventoryProduct): boolean {
  return product.stock_initialized !== false;
}

export function calculateStockCheckUsage(
  currentQuantity: number,
  targetQuantity: string
): number {
  if (!targetQuantity.trim()) {
    throw new Error("실제 남은 수량을 입력해주세요.");
  }
  const actualQuantity = Number(targetQuantity);
  if (!Number.isFinite(actualQuantity)) {
    throw new Error("실제 남은 수량을 숫자로 입력해주세요.");
  }
  if (actualQuantity < 0) {
    throw new Error("실제 남은 수량은 0 이상이어야 합니다.");
  }
  if (actualQuantity > currentQuantity) {
    throw new Error("앱 재고보다 많다면 입고 또는 재고 정정을 사용해주세요.");
  }
  if (actualQuantity === currentQuantity) {
    throw new Error("입력한 수량이 현재 앱 재고와 같습니다.");
  }
  return currentQuantity - actualQuantity;
}

export interface InventoryEventMutationPreview {
  nextQuantity: number | null;
  followingEventCount: number;
  error: string | null;
}

export function previewInventoryEventMutation(
  product: InventoryProduct,
  events: InventoryEvent[],
  targetEventId: string,
  amount: number | null
): InventoryEventMutationPreview {
  const orderedEvents = events
    .filter((event) => event.product_id === product.id)
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
  const targetIndex = orderedEvents.findIndex(
    (event) => event.id === targetEventId
  );
  if (targetIndex < 0) {
    return {
      nextQuantity: null,
      followingEventCount: 0,
      error: "수정할 재고 기록을 찾을 수 없습니다."
    };
  }

  const target = orderedEvents[targetIndex];
  if (target.event_type !== "intake" && target.event_type !== "use") {
    return {
      nextQuantity: null,
      followingEventCount: orderedEvents.length - targetIndex - 1,
      error: "입고 또는 사용 기록만 수정하거나 삭제할 수 있습니다."
    };
  }
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return {
      nextQuantity: null,
      followingEventCount: orderedEvents.length - targetIndex - 1,
      error: "수정 수량은 0보다 커야 합니다."
    };
  }
  if (amount !== null && product.tracking_mode === "cycle" && !Number.isInteger(amount)) {
    return {
      nextQuantity: null,
      followingEventCount: orderedEvents.length - targetIndex - 1,
      error: "개봉·소진 제품의 입고 수량은 정수로 입력해주세요."
    };
  }

  let runningQuantity = 0;
  for (const event of orderedEvents) {
    if (event.id === targetEventId && amount === null) continue;

    let nextQuantity: number;
    switch (event.event_type) {
      case "intake": {
        const eventAmount = event.id === targetEventId
          ? amount!
          : Math.abs(event.quantity_delta);
        nextQuantity = runningQuantity + eventAmount;
        break;
      }
      case "use": {
        const eventAmount = event.id === targetEventId
          ? amount!
          : Math.abs(event.quantity_delta);
        nextQuantity = runningQuantity - eventAmount;
        break;
      }
      case "open":
        if (runningQuantity <= 0) {
          return {
            nextQuantity: null,
            followingEventCount: orderedEvents.length - targetIndex - 1,
            error: `${formatDate(event.occurred_on)} 개봉 기록 시점에 재고가 0이 됩니다.`
          };
        }
        nextQuantity = runningQuantity;
        break;
      case "finish":
        nextQuantity = runningQuantity - 1;
        break;
      case "adjustment":
        nextQuantity = event.quantity_after;
        break;
    }

    if (nextQuantity < 0) {
      return {
        nextQuantity: null,
        followingEventCount: orderedEvents.length - targetIndex - 1,
        error: `${formatDate(event.occurred_on)} 기록을 반영하면 재고가 음수가 됩니다.`
      };
    }
    runningQuantity = nextQuantity;
  }

  return {
    nextQuantity: runningQuantity,
    followingEventCount: orderedEvents.length - targetIndex - 1,
    error: null
  };
}

export function estimateProduct(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  today = todayIso(),
  purchaseStats: PurchaseStats | null = null
): ProductEstimate {
  const productEvents = events.filter((event) => event.product_id === product.id);
  const productCycles = cycles.filter((cycle) => cycle.product_id === product.id);

  const base =
    product.tracking_mode === "cycle"
      ? estimateCycleProduct(product, productCycles, today)
      : estimateDecrementProduct(product, productEvents, today);

  const stockInitialized = isStockInitialized(product);
  const stockBase: ProductEstimate = stockInitialized
    ? base
    : {
        ...base,
        remainingDays: null,
        estimatedOutDate: null,
        forecastSource: null
      };
  const purchaseFallbackDate = purchaseStats?.nextPurchaseDate ?? null;
  const purchaseFallbackDays = purchaseStats?.daysUntilNextPurchase ?? null;
  const usesPurchaseFallback =
    stockBase.remainingDays === null &&
    purchaseFallbackDate !== null &&
    purchaseFallbackDays !== null;
  const remainingDays = usesPurchaseFallback
    ? purchaseFallbackDays
    : stockBase.remainingDays;
  const estimatedOutDate = usesPurchaseFallback
    ? purchaseFallbackDate
    : stockBase.estimatedOutDate;
  const forecastSource: ProductEstimate["forecastSource"] = usesPurchaseFallback
    ? "purchase_interval"
    : stockBase.forecastSource;

  return withProductUrgency(product, {
    ...stockBase,
    remainingDays,
    estimatedOutDate,
    forecastSource
  });
}

export function getInventoryAttentionKind(
  product: InventoryProduct,
  estimate: ProductEstimate
): "quantity" | "depletion" | null {
  if (isDepletionForecastSource(estimate.forecastSource)) {
    return estimate.remainingDays !== null &&
      estimate.remainingDays <= product.alert_days
      ? "depletion"
      : null;
  }

  if (
    isStockInitialized(product) &&
    product.current_quantity <= product.low_stock_threshold
  ) {
    return "quantity";
  }

  return null;
}

export function isRepurchaseDue(
  product: InventoryProduct,
  purchaseStats: PurchaseStats,
  estimate: ProductEstimate | null = null
): boolean {
  if (product.next_sale_on) {
    return daysBetween(todayIso(), product.next_sale_on) <= product.alert_days;
  }
  if (estimate && isDepletionForecastSource(estimate.forecastSource)) {
    return false;
  }
  return (
    purchaseStats.daysUntilNextPurchase !== null &&
    purchaseStats.daysUntilNextPurchase <= product.alert_days
  );
}

export function isInventoryAttentionNeeded(
  product: InventoryProduct,
  estimate: ProductEstimate,
  purchaseStats: PurchaseStats
): boolean {
  return (
    getInventoryAttentionKind(product, estimate) !== null ||
    isRepurchaseDue(product, purchaseStats, estimate)
  );
}

function isDepletionForecastSource(
  source: ProductEstimate["forecastSource"]
): boolean {
  return source === "usage" || source === "purchase_volume";
}

function withProductUrgency(
  product: InventoryProduct,
  estimate: ProductEstimate
): ProductEstimate {
  const hasDepletionForecast = isDepletionForecastSource(estimate.forecastSource);
  const quantityUrgent =
    isStockInitialized(product) &&
    !hasDepletionForecast &&
    product.current_quantity <= product.low_stock_threshold;
  const daysUrgent =
    estimate.remainingDays !== null &&
    estimate.remainingDays <= product.alert_days;

  let urgentReason: string | null = null;
  if (hasDepletionForecast && daysUrgent && estimate.remainingDays !== null) {
    urgentReason = estimate.forecastSource === "purchase_volume"
      ? `과거 구매량으로 추정하면 약 ${Math.max(0, Math.round(estimate.remainingDays))}일 후 재고가 소진됩니다.`
      : `현재 사용 속도라면 약 ${Math.max(0, Math.round(estimate.remainingDays))}일 후 재고가 소진됩니다.`;
  } else if (quantityUrgent) {
    urgentReason = `현재 재고가 알림 기준 ${formatQuantity(product.low_stock_threshold)}${product.unit_label} 이하입니다.`;
  } else if (
    estimate.forecastSource === "purchase_interval" &&
    daysUrgent &&
    estimate.remainingDays !== null
  ) {
    urgentReason = `과거 실제 구매일 기준 다음 재구매 예상일까지 ${Math.max(0, Math.round(estimate.remainingDays))}일 남았습니다.`;
  }

  return {
    ...estimate,
    isUrgent: (hasDepletionForecast && daysUrgent) || quantityUrgent ||
      (estimate.forecastSource === "purchase_interval" && daysUrgent),
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

  const adjustedDurations = recentCycles.map((cycle) => {
    const historicalPeople = Math.max(1, cycle.consumer_count || 1);
    const capacityRatio =
      product.package_size &&
      cycle.package_size &&
      product.capacity_unit &&
      product.capacity_unit === cycle.capacity_unit
        ? product.package_size / cycle.package_size
        : 1;

    const activeDuration = product.active_months
      ? countActiveDays(
          cycle.opened_on,
          addDays(cycle.finished_on, 1),
          product.active_months
        )
      : cycle.duration_days;
    return activeDuration * historicalPeople * capacityRatio;
  });

  const expectedCycleDays = median(adjustedDurations);
  let remainingDays: number | null = null;
  let estimatedOutDate: string | null = null;

  if (expectedCycleDays !== null && expectedCycleDays > 0) {
    const hasActiveProduct = Boolean(product.active_opened_on);
    const unopenedUnits = Math.max(
      0,
      product.current_quantity - (hasActiveProduct ? 1 : 0)
    );
    let activeRemainingDays = 0;

    if (product.active_opened_on) {
      const elapsedDays = countActiveDays(
        product.active_opened_on,
        today,
        product.active_months
      );
      const activePeople = Math.max(
        1,
        product.active_consumer_count || product.current_consumer_count || 1
      );
      const elapsedPersonDays = elapsedDays * activePeople;
      activeRemainingDays = Math.max(0, expectedCycleDays - elapsedPersonDays);
    }

    const remainingActiveDays = hasActiveProduct
      ? activeRemainingDays + unopenedUnits * expectedCycleDays
      : product.current_quantity * expectedCycleDays;
    estimatedOutDate = addActiveDays(
      today,
      Math.max(0, Math.ceil(remainingActiveDays)),
      product.active_months
    );
    remainingDays = daysBetween(today, estimatedOutDate);
  }

  const perPersonDailyCapacity =
    product.package_size && expectedCycleDays
      ? product.package_size / expectedCycleDays
      : null;

  return {
    isUrgent: false,
    urgentReason: null,
    isLearning: recentCycles.length === 0,
    forecastSource: remainingDays === null ? null : "usage",
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
      const interval = countActiveDays(
        samples[index - 1].date,
        samples[index].date,
        product.active_months
      );
      if (interval > 0) intervals.push(interval);
    }

    const typicalInterval = median(intervals);
    const typicalAmount = median(samples.map((sample) => sample.amount));
    if (typicalInterval !== null && typicalAmount && typicalAmount > 0) {
      daysPerUnit = typicalInterval / typicalAmount;
    }
  }

  const remainingActiveDays =
    daysPerUnit === null
      ? null
      : Math.max(0, product.current_quantity * daysPerUnit);
  const estimatedOutDate = remainingActiveDays === null
    ? null
    : addActiveDays(
        today,
        Math.max(0, Math.ceil(remainingActiveDays)),
        product.active_months
      );
  const remainingDays = estimatedOutDate === null
    ? null
    : daysBetween(today, estimatedOutDate);

  return {
    isUrgent: false,
    urgentReason: null,
    isLearning: samples.length < 2,
    forecastSource: remainingDays === null ? null : "usage",
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
  events: InventoryEvent[] = [],
  today = todayIso()
): PurchaseStats {
  const productPurchases = purchases.filter(
    (purchase) => purchase.product_id === productId
  );
  const productIntakes = events.filter(
    (event) =>
      event.product_id === productId &&
      event.event_type === "intake"
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
  const latestPurchase = lastPurchasedOn
    ? productPurchases
        .filter((purchase) => purchase.purchased_on === lastPurchasedOn)
        .reduce<number>((sum, purchase) => sum + purchase.package_count, 0)
    : null;
  const latestIntake = [...productIntakes].sort((a, b) => {
    const dateComparison = compareIsoDate(b.occurred_on, a.occurred_on);
    return dateComparison || b.created_at.localeCompare(a.created_at);
  })[0] ?? null;
  const nextPurchaseDate =
    lastPurchasedOn && medianIntervalDays !== null
      ? addDays(lastPurchasedOn, Math.round(medianIntervalDays))
      : null;

  return {
    purchaseRecordCount: productPurchases.length,
    purchaseDateCount: uniqueDates.length,
    totalPackageCount: productPurchases.reduce(
      (sum, purchase) => sum + purchase.package_count,
      0
    ),
    intervalSampleCount: recentIntervals.length,
    medianIntervalDays,
    firstPurchasedOn: uniqueDates[0] ?? null,
    lastPurchasedOn,
    lastPurchasePackageCount: latestPurchase,
    latestIntakeOn: latestIntake?.occurred_on ?? null,
    latestIntakeQuantity: latestIntake
      ? Math.abs(latestIntake.quantity_delta)
      : null,
    nextPurchaseDate,
    daysUntilNextPurchase:
      nextPurchaseDate === null ? null : daysBetween(today, nextPurchaseDate)
  };
}

export function calculateConsumptionStats(
  product: InventoryProduct,
  purchases: InventoryPurchase[],
  events: InventoryEvent[],
  estimate: ProductEstimate,
  today = todayIso()
): ConsumptionStats {
  const usageBased = usageBasedConsumption(product, estimate, today);
  const base = usageBased ?? purchaseBasedConsumption(
    product,
    purchases,
    events,
    today
  );
  const dailyPackageCount = base.activeMonthlyPackageCount === null
    ? null
    : base.activeMonthlyPackageCount / AVERAGE_DAYS_PER_MONTH;
  const hasPurchasePlan = Boolean(
    product.next_sale_on &&
    product.purchase_coverage_months &&
    dailyPackageCount !== null
  );
  let expectedStockOnSaleDate: number | null = null;
  let recommendedPurchaseQuantity: number | null = null;

  if (
    hasPurchasePlan &&
    product.next_sale_on &&
    product.purchase_coverage_months &&
    dailyPackageCount !== null
  ) {
    const usageDaysUntilSale = countActiveDays(
      today,
      product.next_sale_on,
      product.active_months
    );
    expectedStockOnSaleDate = Math.max(
      0,
      product.current_quantity - dailyPackageCount * usageDaysUntilSale
    );
    const coverageEnd = addMonths(
      product.next_sale_on,
      product.purchase_coverage_months
    );
    const coverageUsageDays = countActiveDays(
      product.next_sale_on,
      coverageEnd,
      product.active_months
    );
    recommendedPurchaseQuantity = Math.max(
      0,
      Math.ceil(
        dailyPackageCount * coverageUsageDays +
        (product.purchase_safety_quantity || 0) -
        expectedStockOnSaleDate
      )
    );
  }

  return {
    ...base,
    recommendedPurchaseQuantity,
    expectedStockOnSaleDate
  };
}

export function calculateProductAnalysis(
  product: InventoryProduct,
  purchases: InventoryPurchase[],
  events: InventoryEvent[],
  cycles: UsageCycle[],
  purchaseStats: PurchaseStats | null = null,
  today = todayIso()
): { estimate: ProductEstimate; consumptionStats: ConsumptionStats } {
  const resolvedPurchaseStats = purchaseStats ?? calculatePurchaseStats(
    product.id,
    purchases,
    events,
    today
  );
  const baseEstimate = estimateProduct(
    product,
    events,
    cycles,
    today,
    resolvedPurchaseStats
  );
  const consumptionStats = calculateConsumptionStats(
    product,
    purchases,
    events,
    baseEstimate,
    today
  );

  return {
    estimate: applyPurchaseConsumptionForecast(
      product,
      baseEstimate,
      consumptionStats,
      today
    ),
    consumptionStats
  };
}

function applyPurchaseConsumptionForecast(
  product: InventoryProduct,
  estimate: ProductEstimate,
  stats: ConsumptionStats,
  today: string
): ProductEstimate {
  if (
    !isStockInitialized(product) ||
    estimate.forecastSource === "usage" ||
    !isQualifiedPurchaseConsumption(stats) ||
    stats.activeMonthlyPackageCount === null ||
    stats.activeMonthlyPackageCount <= 0
  ) {
    return estimate;
  }

  const dailyUnitCount =
    stats.activeMonthlyPackageCount / AVERAGE_DAYS_PER_MONTH;
  const activeDaysPerUnit = 1 / dailyUnitCount;
  let remainingActiveDays =
    Math.max(0, product.current_quantity) * activeDaysPerUnit;

  if (product.tracking_mode === "cycle" && product.active_opened_on) {
    const elapsedActiveDays = countActiveDays(
      product.active_opened_on,
      today,
      product.active_months
    );
    const openedUnitRemainingDays = Math.max(
      0,
      activeDaysPerUnit - elapsedActiveDays
    );
    const unopenedUnitCount = Math.max(0, product.current_quantity - 1);
    remainingActiveDays =
      openedUnitRemainingDays + unopenedUnitCount * activeDaysPerUnit;
  }

  const estimatedOutDate = addActiveDays(
    today,
    Math.max(0, Math.ceil(remainingActiveDays)),
    product.active_months
  );
  return withProductUrgency(product, {
    ...estimate,
    forecastSource: "purchase_volume",
    remainingDays: daysBetween(today, estimatedOutDate),
    estimatedOutDate
  });
}

function isQualifiedPurchaseConsumption(stats: ConsumptionStats): boolean {
  const validRecordCount = stats.sampleCount - stats.excludedSizeRecordCount;
  return (
    stats.source === "purchase" &&
    validRecordCount >= PURCHASE_FORECAST_MIN_RECORDS &&
    stats.observationDays !== null &&
    stats.observationDays >= PURCHASE_FORECAST_MIN_OBSERVATION_DAYS &&
    stats.excludedSizeRecordCount <= validRecordCount
  );
}

function usageBasedConsumption(
  product: InventoryProduct,
  estimate: ProductEstimate,
  today: string
): Omit<ConsumptionStats, "recommendedPurchaseQuantity" | "expectedStockOnSaleDate"> | null {
  if (
    product.tracking_mode === "cycle" &&
    product.package_size &&
    product.capacity_unit &&
    estimate.expectedCycleDays &&
    estimate.expectedCycleDays > 0
  ) {
    return buildConsumptionStats(
      product,
      1 / estimate.expectedCycleDays,
      product.package_size / estimate.expectedCycleDays,
      product.capacity_unit,
      "usage",
      estimate.cycleSampleCount,
      null,
      0,
      0,
      today
    );
  }

  if (
    product.tracking_mode === "count" &&
    estimate.daysPerUnit &&
    estimate.daysPerUnit > 0
  ) {
    const dailyAmount = 1 / estimate.daysPerUnit;
    return buildConsumptionStats(
      product,
      dailyAmount,
      dailyAmount,
      product.unit_label,
      "usage",
      estimate.useSampleCount,
      null,
      0,
      0,
      today
    );
  }

  return null;
}

function purchaseBasedConsumption(
  product: InventoryProduct,
  purchases: InventoryPurchase[],
  events: InventoryEvent[],
  today: string
): Omit<ConsumptionStats, "recommendedPurchaseQuantity" | "expectedStockOnSaleDate"> {
  const firstTrackingEvent = events
    .filter((event) => event.product_id === product.id)
    .map((event) => event.occurred_on)
    .sort(compareIsoDate)[0] ?? today;
  const historicalPurchases = purchases.filter(
    (purchase) =>
      purchase.product_id === product.id &&
      purchase.purchased_on < firstTrackingEvent
  );
  const firstPurchaseOn = historicalPurchases
    .map((purchase) => purchase.purchased_on)
    .sort(compareIsoDate)[0] ?? null;
  const observationDays = firstPurchaseOn
    ? daysBetween(firstPurchaseOn, firstTrackingEvent)
    : null;

  if (!firstPurchaseOn || !observationDays || observationDays < 30) {
    return emptyConsumptionStats(observationDays);
  }

  const totalPackages = historicalPurchases.reduce(
    (sum, purchase) => sum + purchase.package_count,
    0
  );
  const activeObservationDays = countActiveDays(
    firstPurchaseOn,
    firstTrackingEvent,
    product.active_months
  );
  if (activeObservationDays <= 0) {
    return emptyConsumptionStats(observationDays);
  }
  const dailyPackageCount = totalPackages / activeObservationDays;

  if (product.tracking_mode === "count") {
    return buildConsumptionStats(
      product,
      dailyPackageCount,
      dailyPackageCount,
      product.unit_label,
      "purchase",
      historicalPurchases.length,
      observationDays,
      0,
      0,
      today
    );
  }

  if (!product.package_size || !product.capacity_unit) {
    return emptyConsumptionStats(observationDays);
  }

  let totalCapacity = 0;
  let inferredSizeRecordCount = 0;
  let excludedSizeRecordCount = 0;
  historicalPurchases.forEach((purchase) => {
    if (purchase.package_size === null || !purchase.package_unit) {
      totalCapacity += purchase.package_count * product.package_size!;
      inferredSizeRecordCount += 1;
      return;
    }
    if (purchase.package_unit.toLowerCase() !== product.capacity_unit!.toLowerCase()) {
      excludedSizeRecordCount += 1;
      return;
    }
    totalCapacity += purchase.package_count * purchase.package_size;
  });

  if (totalCapacity <= 0) {
    return emptyConsumptionStats(observationDays, excludedSizeRecordCount);
  }

  return buildConsumptionStats(
    product,
    dailyPackageCount,
    totalCapacity / activeObservationDays,
    product.capacity_unit,
    "purchase",
    historicalPurchases.length,
    observationDays,
    inferredSizeRecordCount,
    excludedSizeRecordCount,
    today
  );
}

function buildConsumptionStats(
  product: InventoryProduct,
  dailyPackageCount: number,
  dailyAmount: number,
  monthlyUnit: string,
  source: "usage" | "purchase",
  sampleCount: number,
  observationDays: number | null,
  inferredSizeRecordCount: number,
  excludedSizeRecordCount: number,
  today: string
): Omit<ConsumptionStats, "recommendedPurchaseQuantity" | "expectedStockOnSaleDate"> {
  const annualUsageDays = averageActiveDaysPerYear(product.active_months);
  const annualPackageCount = dailyPackageCount * annualUsageDays;
  const annualAmount = dailyAmount * annualUsageDays;
  const season = findNextUsageSeason(today, product.active_months);
  const seasonUsageDays = season
    ? countActiveDays(season.startOn, addDays(season.endOn, 1), product.active_months)
    : null;

  return {
    source,
    monthlyAmount: annualAmount / 12,
    monthlyUnit,
    monthlyPackageCount: annualPackageCount / 12,
    activeMonthlyAmount: dailyAmount * AVERAGE_DAYS_PER_MONTH,
    activeMonthlyPackageCount: dailyPackageCount * AVERAGE_DAYS_PER_MONTH,
    annualAmount,
    annualPackageCount,
    nextSeasonStartOn: season?.startOn ?? null,
    nextSeasonEndOn: season?.endOn ?? null,
    nextSeasonAmount: seasonUsageDays === null ? null : dailyAmount * seasonUsageDays,
    nextSeasonPackageCount:
      seasonUsageDays === null ? null : dailyPackageCount * seasonUsageDays,
    sampleCount,
    observationDays,
    inferredSizeRecordCount,
    excludedSizeRecordCount
  };
}

function emptyConsumptionStats(
  observationDays: number | null,
  excludedSizeRecordCount = 0
): Omit<ConsumptionStats, "recommendedPurchaseQuantity" | "expectedStockOnSaleDate"> {
  return {
    source: null,
    monthlyAmount: null,
    monthlyUnit: null,
    monthlyPackageCount: null,
    activeMonthlyAmount: null,
    activeMonthlyPackageCount: null,
    annualAmount: null,
    annualPackageCount: null,
    nextSeasonStartOn: null,
    nextSeasonEndOn: null,
    nextSeasonAmount: null,
    nextSeasonPackageCount: null,
    sampleCount: 0,
    observationDays,
    inferredSizeRecordCount: 0,
    excludedSizeRecordCount
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

export function parseDateInput(value: string): string | null {
  const trimmed = value.trim();
  const usMatch = trimmed.match(
    /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/
  );

  if (usMatch) {
    return toIsoDate(
      Number(usMatch[3]),
      Number(usMatch[1]),
      Number(usMatch[2])
    );
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  const koreanMatch = trimmed.match(
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*\.?$/
  );
  const separatedMatch = trimmed.match(
    /^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*\.?$/
  );
  const match = compactMatch || koreanMatch || separatedMatch;
  if (!match) return null;

  return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function normalizePurchaseDate(value: string): string | null {
  return parseDateInput(value);
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

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

export function usageCycleDurationDays(openedOn: string, finishedOn: string): number {
  return daysBetween(openedOn, finishedOn) + 1;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(isoToUtcMs(iso) + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function countActiveDays(
  fromIso: string,
  toIso: string,
  activeMonths: number[] | null | undefined
): number {
  if (toIso <= fromIso) return 0;
  const months = normalizedActiveMonths(activeMonths);
  if (!months) return daysBetween(fromIso, toIso);

  let count = 0;
  for (let date = fromIso; date < toIso; date = addDays(date, 1)) {
    if (months.has(Number(date.slice(5, 7)))) count += 1;
  }
  return count;
}

function addActiveDays(
  iso: string,
  days: number,
  activeMonths: number[] | null | undefined
): string {
  const months = normalizedActiveMonths(activeMonths);
  if (!months) return addDays(iso, days);

  let date = iso;
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    date = addDays(date, 1);
    if (months.has(Number(date.slice(5, 7)))) remaining -= 1;
  }
  return date;
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(
    firstOfTarget.getUTCFullYear(),
    firstOfTarget.getUTCMonth() + 1,
    0
  )).getUTCDate();
  return toIsoDate(
    firstOfTarget.getUTCFullYear(),
    firstOfTarget.getUTCMonth() + 1,
    Math.min(day, lastDay)
  )!;
}

function averageActiveDaysPerYear(
  activeMonths: number[] | null | undefined
): number {
  const months = normalizedActiveMonths(activeMonths);
  if (!months) {
    return AVERAGE_MONTH_DAYS.reduce((sum, days) => sum + days, 0);
  }
  return [...months].reduce(
    (sum, month) => sum + AVERAGE_MONTH_DAYS[month - 1],
    0
  );
}

function findNextUsageSeason(
  today: string,
  activeMonths: number[] | null | undefined
): { startOn: string; endOn: string } | null {
  const months = normalizedActiveMonths(activeMonths);
  if (!months) return null;

  const [year, month] = today.split("-").map(Number);
  let startIndex = year * 12 + month - 1;
  const monthAt = (index: number) => ((index % 12) + 12) % 12 + 1;

  if (months.has(month)) {
    while (months.has(monthAt(startIndex - 1))) startIndex -= 1;
  } else {
    while (!months.has(monthAt(startIndex))) startIndex += 1;
  }

  let endIndex = startIndex;
  while (months.has(monthAt(endIndex))) endIndex += 1;

  const monthStart = (index: number) => {
    const date = new Date(Date.UTC(Math.floor(index / 12), index % 12, 1));
    return date.toISOString().slice(0, 10);
  };
  return {
    startOn: monthStart(startIndex),
    endOn: addDays(monthStart(endIndex), -1)
  };
}

function normalizedActiveMonths(
  activeMonths: number[] | null | undefined
): Set<number> | null {
  if (!activeMonths || activeMonths.length === 0 || activeMonths.length === 12) {
    return null;
  }
  return new Set(activeMonths);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDateInput(iso) || "—";
}

export function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!toIsoDate(year, month, day)) return "";
  return `${month}/${day}/${year}`;
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
  unitLabel: string
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
    case "adjustment":
      return `재고 ${formatQuantity(event.quantity_after)}${unitLabel}으로 정정`;
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
    case "stock_check":
      return "남은 수량을 확인해";
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
