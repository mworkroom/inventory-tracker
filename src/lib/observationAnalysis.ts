import type {
  ConsumptionStats,
  InventoryConsumptionBaseline,
  InventoryEvent,
  InventoryProduct,
  InventoryProductSaleSchedule,
  MonthlyConsumptionActual,
  ProductEstimate,
  PurchaseStats,
  SaleRecommendation,
  SeasonalityStats,
  UsageCycle,
  UsageTracking
} from "../types";
import {
  addDays,
  daysBetween,
  formatQuantity,
  isStockInitialized,
  median,
  todayIso,
  usageCycleDurationDays
} from "./inventory";

const AVERAGE_DAYS_PER_MONTH = 30.4375;
const AVERAGE_DAYS_PER_YEAR = 365.25;
const MAX_FORECAST_DAYS = Math.ceil(AVERAGE_DAYS_PER_YEAR * 20);

interface ConsumptionRate {
  source: "usage" | "recalled_baseline";
  dailyPackageCount: number;
  dailyAmount: number;
  amountUnit: string;
  sampleCount: number;
  observationDays: number | null;
  expectedCycleDays: number | null;
  daysPerUnit: number | null;
  perPersonDailyCapacity: number | null;
  cycleSampleCount: number;
  useSampleCount: number;
}

interface ActualEvidence {
  rate: ConsumptionRate | null;
  monthlyActuals: MonthlyConsumptionActual[];
  actualRecordCount: number;
  observationStartedOn: string | null;
}

export function usageTrackingOf(product: InventoryProduct): UsageTracking {
  return product.usage_tracking ||
    (product.tracking_mode === "cycle" ? "cycle" : "decrement");
}

export function calculateProductAnalysis(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  baseline: InventoryConsumptionBaseline | null,
  saleSchedules: InventoryProductSaleSchedule[],
  today = todayIso()
): { estimate: ProductEstimate; consumptionStats: ConsumptionStats } {
  const actual = buildActualEvidence(product, events, cycles);
  const rate = actual.rate
    ? applyObservedAnnualRate(actual.rate, actual, today)
    : buildBaselineRate(product, baseline);
  const seasonality = calculateSeasonality(actual, today);
  const estimate = buildEstimate(
    product,
    rate,
    seasonality,
    actual.actualRecordCount,
    today
  );
  const consumptionStats = buildConsumptionStats(
    product,
    rate,
    actual.monthlyActuals,
    seasonality,
    saleSchedules,
    today
  );
  return { estimate, consumptionStats };
}

export function estimateProduct(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  baseline: InventoryConsumptionBaseline | null = null,
  today = todayIso()
): ProductEstimate {
  return calculateProductAnalysis(product, events, cycles, baseline, [], today)
    .estimate;
}

export function calculateConsumptionStats(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  baseline: InventoryConsumptionBaseline | null = null,
  saleSchedules: InventoryProductSaleSchedule[] = [],
  today = todayIso()
): ConsumptionStats {
  return calculateProductAnalysis(
    product,
    events,
    cycles,
    baseline,
    saleSchedules,
    today
  ).consumptionStats;
}

export function getInventoryAttentionKind(
  product: InventoryProduct,
  estimate: ProductEstimate
): "quantity" | "depletion" | null {
  if (estimate.forecastSource) {
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
  estimate: ProductEstimate | null = null,
  consumptionStats: ConsumptionStats | null = null,
  today = todayIso()
): boolean {
  const sale = consumptionStats?.saleRecommendation;
  if (sale) {
    const active = sale.opportunityOn <= today && today <= sale.validThrough;
    return active || daysBetween(today, sale.opportunityOn) <= product.alert_days;
  }
  if (estimate?.forecastSource) return false;
  return purchaseStats.daysUntilNextPurchase !== null &&
    purchaseStats.daysUntilNextPurchase <= product.alert_days;
}

export function isInventoryAttentionNeeded(
  product: InventoryProduct,
  estimate: ProductEstimate,
  purchaseStats: PurchaseStats,
  consumptionStats: ConsumptionStats | null = null
): boolean {
  return getInventoryAttentionKind(product, estimate) !== null ||
    isRepurchaseDue(product, purchaseStats, estimate, consumptionStats);
}

function buildActualEvidence(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[]
): ActualEvidence {
  return usageTrackingOf(product) === "cycle"
    ? buildCycleEvidence(product, cycles)
    : buildDecrementEvidence(product, events);
}

function buildCycleEvidence(
  product: InventoryProduct,
  cycles: UsageCycle[]
): ActualEvidence {
  const productCycles = cycles
    .filter((cycle) => cycle.product_id === product.id)
    .sort((a, b) => b.finished_on.localeCompare(a.finished_on));
  const recentCycles = productCycles.slice(0, 5);
  const adjustedDurations = recentCycles.map((cycle) => {
    const people = Math.max(1, cycle.consumer_count || 1);
    const capacityRatio = product.package_size && cycle.package_size &&
      product.capacity_unit && product.capacity_unit === cycle.capacity_unit
      ? product.package_size / cycle.package_size
      : 1;
    return usageCycleDurationDays(cycle.opened_on, cycle.finished_on) *
      people * capacityRatio;
  });
  const expectedCycleDays = median(adjustedDurations);
  const amountUnit = product.package_size && product.capacity_unit
    ? product.capacity_unit
    : product.unit_label;
  const dailyPackageCount = expectedCycleDays && expectedCycleDays > 0
    ? 1 / expectedCycleDays
    : null;
  const rate: ConsumptionRate | null = dailyPackageCount === null
    ? null
    : {
        source: "usage",
        dailyPackageCount,
        dailyAmount: product.package_size
          ? product.package_size * dailyPackageCount
          : dailyPackageCount,
        amountUnit,
        sampleCount: recentCycles.length,
        observationDays: observationDaysForCycles(productCycles),
        expectedCycleDays,
        daysPerUnit: expectedCycleDays,
        perPersonDailyCapacity: product.package_size
          ? product.package_size / (expectedCycleDays as number)
          : null,
        cycleSampleCount: recentCycles.length,
        useSampleCount: 0
      };

  return {
    rate,
    monthlyActuals: cycleMonthlyActuals(product, productCycles),
    actualRecordCount: productCycles.length,
    observationStartedOn: productCycles.length
      ? productCycles.reduce(
          (earliest, cycle) => cycle.opened_on < earliest
            ? cycle.opened_on
            : earliest,
          productCycles[0].opened_on
        )
      : null
  };
}

function buildDecrementEvidence(
  product: InventoryProduct,
  events: InventoryEvent[]
): ActualEvidence {
  const dailyUse = new Map<string, number>();
  events
    .filter((event) =>
      event.product_id === product.id &&
      event.event_type === "use" &&
      event.quantity_delta < 0
    )
    .forEach((event) => {
      dailyUse.set(
        event.occurred_on,
        (dailyUse.get(event.occurred_on) || 0) + Math.abs(event.quantity_delta)
      );
    });
  const allSamples = [...dailyUse.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const samples = allSamples.slice(-8);
  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const interval = daysBetween(samples[index - 1].date, samples[index].date);
    if (interval > 0) intervals.push(interval);
  }
  const typicalInterval = median(intervals);
  const typicalAmount = median(samples.map((sample) => sample.amount));
  const daysPerUnit = samples.length >= 2 && typicalInterval !== null &&
    typicalAmount !== null && typicalAmount > 0
    ? typicalInterval / typicalAmount
    : null;
  const dailyPackageCount = daysPerUnit && daysPerUnit > 0
    ? 1 / daysPerUnit
    : null;
  const amountUnit = product.package_size && product.capacity_unit
    ? product.capacity_unit
    : product.unit_label;
  const rate: ConsumptionRate | null = dailyPackageCount === null
    ? null
    : {
        source: "usage",
        dailyPackageCount,
        dailyAmount: product.package_size
          ? product.package_size * dailyPackageCount
          : dailyPackageCount,
        amountUnit,
        sampleCount: samples.length,
        observationDays: allSamples.length >= 2
          ? daysBetween(allSamples[0].date, allSamples[allSamples.length - 1].date)
          : null,
        expectedCycleDays: null,
        daysPerUnit,
        perPersonDailyCapacity: null,
        cycleSampleCount: 0,
        useSampleCount: samples.length
      };

  return {
    rate,
    monthlyActuals: decrementMonthlyActuals(product, allSamples),
    actualRecordCount: allSamples.length,
    observationStartedOn: allSamples[0]?.date || null
  };
}

function buildBaselineRate(
  product: InventoryProduct,
  baseline: InventoryConsumptionBaseline | null
): ConsumptionRate | null {
  if (!baseline || baseline.product_id !== product.id ||
      baseline.usage_tracking !== usageTrackingOf(product)) {
    return null;
  }
  const durationDays = usageCycleDurationDays(
    baseline.started_on,
    baseline.ended_on
  );
  const personDays = durationDays * Math.max(1, baseline.consumer_count || 1);
  if (personDays <= 0) return null;

  let dailyPackageCount: number;
  let expectedCycleDays: number | null = null;
  if (usageTrackingOf(product) === "cycle") {
    const capacityRatio = product.package_size && baseline.package_size &&
      product.capacity_unit && product.capacity_unit === baseline.capacity_unit
      ? product.package_size / baseline.package_size
      : 1;
    expectedCycleDays = personDays * capacityRatio;
    dailyPackageCount = 1 / expectedCycleDays;
  } else if (
    product.package_size && baseline.package_size &&
    product.capacity_unit && product.capacity_unit === baseline.capacity_unit
  ) {
    dailyPackageCount = baseline.consumed_quantity * baseline.package_size /
      product.package_size / personDays;
  } else {
    if (baseline.quantity_unit !== product.unit_label) return null;
    dailyPackageCount = baseline.consumed_quantity / personDays;
  }
  if (!Number.isFinite(dailyPackageCount) || dailyPackageCount <= 0) return null;

  const amountUnit = product.package_size && product.capacity_unit
    ? product.capacity_unit
    : product.unit_label;
  return {
    source: "recalled_baseline",
    dailyPackageCount,
    dailyAmount: product.package_size
      ? product.package_size * dailyPackageCount
      : dailyPackageCount,
    amountUnit,
    sampleCount: 1,
    observationDays: durationDays,
    expectedCycleDays,
    daysPerUnit: 1 / dailyPackageCount,
    perPersonDailyCapacity: product.package_size
      ? product.package_size * dailyPackageCount
      : null,
    cycleSampleCount: 0,
    useSampleCount: 0
  };
}

function applyObservedAnnualRate(
  rate: ConsumptionRate,
  actual: ActualEvidence,
  today: string
): ConsumptionRate {
  const completeMonths = completeCalendarMonths(actual.observationStartedOn, today);
  if (completeMonths.length < 12) return rate;

  const recentMonths = new Set(completeMonths.slice(-12));
  const observed = actual.monthlyActuals.filter((month) =>
    recentMonths.has(month.month)
  );
  const annualPackageCount = observed.reduce(
    (sum, month) => sum + month.packageCount,
    0
  );
  const annualAmount = observed.reduce((sum, month) => sum + month.amount, 0);
  if (annualPackageCount <= 0 || annualAmount <= 0) return rate;

  return {
    ...rate,
    dailyPackageCount: annualPackageCount / AVERAGE_DAYS_PER_YEAR,
    dailyAmount: annualAmount / AVERAGE_DAYS_PER_YEAR,
    observationDays: Math.round(AVERAGE_DAYS_PER_YEAR)
  };
}

function buildEstimate(
  product: InventoryProduct,
  rate: ConsumptionRate | null,
  seasonality: SeasonalityStats,
  actualRecordCount: number,
  today: string
): ProductEstimate {
  const effectiveStock = isStockInitialized(product) && rate
    ? effectiveStockQuantity(product, rate, today)
    : null;
  const remainingDays = effectiveStock !== null && rate
    ? forecastDays(
        effectiveStock,
        rate.dailyPackageCount,
        seasonality.monthlyShares,
        today
      )
    : null;
  const estimatedOutDate = remainingDays === null
    ? null
    : addDays(today, remainingDays);
  const forecastSource = remainingDays === null ? null : rate?.source || null;
  const quantityUrgent = isStockInitialized(product) && !forecastSource &&
    product.current_quantity <= product.low_stock_threshold;
  const daysUrgent = remainingDays !== null && remainingDays <= product.alert_days;
  let urgentReason: string | null = null;
  if (daysUrgent && remainingDays !== null) {
    urgentReason = forecastSource === "recalled_baseline"
      ? "회상 소비 기준으로 추정하면 약 " + Math.max(0, Math.round(remainingDays)) +
        "일 후 재고가 소진됩니다."
      : "현재 사용 속도라면 약 " + Math.max(0, Math.round(remainingDays)) +
        "일 후 재고가 소진됩니다.";
  } else if (quantityUrgent) {
    urgentReason = "현재 재고가 알림 기준 " +
      formatQuantity(product.low_stock_threshold) + product.unit_label +
      " 이하입니다.";
  }

  return {
    isUrgent: daysUrgent || quantityUrgent,
    urgentReason,
    isLearning: rate === null,
    forecastSource,
    remainingDays,
    estimatedOutDate,
    expectedCycleDays: rate?.expectedCycleDays || null,
    daysPerUnit: rate?.daysPerUnit || null,
    perPersonDailyCapacity: rate?.perPersonDailyCapacity || null,
    cycleSampleCount: usageTrackingOf(product) === "cycle"
      ? Math.min(actualRecordCount, 5)
      : 0,
    useSampleCount: usageTrackingOf(product) === "decrement"
      ? Math.min(actualRecordCount, 8)
      : 0
  };
}

function buildConsumptionStats(
  product: InventoryProduct,
  rate: ConsumptionRate | null,
  monthlyActuals: MonthlyConsumptionActual[],
  seasonality: SeasonalityStats,
  saleSchedules: InventoryProductSaleSchedule[],
  today: string
): ConsumptionStats {
  const monthlyPackageCount = rate
    ? rate.dailyPackageCount * AVERAGE_DAYS_PER_MONTH
    : null;
  const annualPackageCount = rate
    ? rate.dailyPackageCount * AVERAGE_DAYS_PER_YEAR
    : null;
  return {
    source: rate?.source || null,
    monthlyAmount: rate ? rate.dailyAmount * AVERAGE_DAYS_PER_MONTH : null,
    monthlyUnit: rate?.amountUnit || (monthlyActuals.length
      ? product.package_size && product.capacity_unit
        ? product.capacity_unit
        : product.unit_label
      : null),
    monthlyPackageCount,
    annualAmount: rate ? rate.dailyAmount * AVERAGE_DAYS_PER_YEAR : null,
    annualPackageCount,
    sampleCount: rate?.sampleCount || 0,
    observationDays: rate?.observationDays || null,
    monthlyActuals,
    seasonality,
    saleRecommendation: calculateSaleRecommendation(
      product,
      rate,
      seasonality.monthlyShares,
      saleSchedules,
      today
    )
  };
}

function effectiveStockQuantity(
  product: InventoryProduct,
  rate: ConsumptionRate,
  today: string
): number {
  if (usageTrackingOf(product) !== "cycle" || !product.active_opened_on ||
      !rate.expectedCycleDays) {
    return Math.max(0, product.current_quantity);
  }
  const unopened = Math.max(0, product.current_quantity - 1);
  const elapsedDays = Math.max(0, daysBetween(product.active_opened_on, today));
  const people = Math.max(
    1,
    product.active_consumer_count || product.current_consumer_count || 1
  );
  const remainingActive = Math.max(
    0,
    1 - elapsedDays * people / rate.expectedCycleDays
  );
  return unopened + remainingActive;
}

function forecastDays(
  stock: number,
  dailyPackageCount: number,
  monthlyShares: number[] | null,
  from: string
): number | null {
  if (stock <= 0) return 0;
  if (dailyPackageCount <= 0) return null;
  if (!monthlyShares) return Math.ceil(stock / dailyPackageCount);

  const annualPackages = dailyPackageCount * AVERAGE_DAYS_PER_YEAR;
  let remaining = stock;
  for (let offset = 0; offset <= MAX_FORECAST_DAYS; offset += 1) {
    const date = addDays(from, offset);
    remaining -= seasonalDailyPackages(date, annualPackages, monthlyShares);
    if (remaining <= 0) return offset;
  }
  return null;
}

function consumptionBetween(
  from: string,
  to: string,
  dailyPackageCount: number,
  monthlyShares: number[] | null
): number {
  if (to <= from) return 0;
  if (!monthlyShares) return daysBetween(from, to) * dailyPackageCount;
  const annualPackages = dailyPackageCount * AVERAGE_DAYS_PER_YEAR;
  let total = 0;
  for (let date = from; date < to; date = addDays(date, 1)) {
    total += seasonalDailyPackages(date, annualPackages, monthlyShares);
  }
  return total;
}

function seasonalDailyPackages(
  date: string,
  annualPackages: number,
  monthlyShares: number[]
): number {
  const month = Number(date.slice(5, 7));
  return annualPackages * (monthlyShares[month - 1] || 0) /
    daysInMonth(date);
}

function calculateSaleRecommendation(
  product: InventoryProduct,
  rate: ConsumptionRate | null,
  monthlyShares: number[] | null,
  schedules: InventoryProductSaleSchedule[],
  today: string
): SaleRecommendation | null {
  const productSchedules = schedules.filter(
    (schedule) => schedule.product_id === product.id
  );
  const opportunity = findSaleOpportunity(productSchedules, today, null);
  if (!opportunity) return null;
  const nextOpportunity = findSaleOpportunity(
    productSchedules,
    addDays(opportunity.validThrough, 1),
    opportunity.monthKey
  );
  if (!nextOpportunity) return null;

  if (!rate || !isStockInitialized(product)) {
    return {
      scheduleId: opportunity.schedule.id,
      scheduleName: opportunity.schedule.name,
      storeId: opportunity.schedule.store_id,
      opportunityOn: opportunity.opportunityOn,
      validThrough: opportunity.validThrough,
      nextOpportunityOn: nextOpportunity.opportunityOn,
      expectedStockOnOpportunity: null,
      recommendedQuantity: null,
      temporaryPurchaseQuantity: null
    };
  }

  const effectiveOpportunityOn = opportunity.opportunityOn < today
    ? today
    : opportunity.opportunityOn;
  const currentStock = effectiveStockQuantity(product, rate, today);
  const usageBeforeOpportunity = consumptionBetween(
    today,
    effectiveOpportunityOn,
    rate.dailyPackageCount,
    monthlyShares
  );
  const expectedStock = currentStock - usageBeforeOpportunity;
  const temporaryPurchaseQuantity = expectedStock < 0
    ? Math.ceil(Math.abs(expectedStock))
    : 0;
  const stockAtOpportunity = Math.max(
    0,
    expectedStock + temporaryPurchaseQuantity
  );
  const coverageUsage = consumptionBetween(
    effectiveOpportunityOn,
    nextOpportunity.opportunityOn,
    rate.dailyPackageCount,
    monthlyShares
  );
  const recommendedQuantity = Math.max(
    0,
    Math.ceil(
      coverageUsage + (product.purchase_safety_quantity || 0) - stockAtOpportunity
    )
  );

  return {
    scheduleId: opportunity.schedule.id,
    scheduleName: opportunity.schedule.name,
    storeId: opportunity.schedule.store_id,
    opportunityOn: opportunity.opportunityOn,
    validThrough: opportunity.validThrough,
    nextOpportunityOn: nextOpportunity.opportunityOn,
    expectedStockOnOpportunity: expectedStock,
    recommendedQuantity,
    temporaryPurchaseQuantity
  };
}

interface SaleOpportunity {
  schedule: InventoryProductSaleSchedule;
  opportunityOn: string;
  validThrough: string;
  monthKey: string;
}

function findSaleOpportunity(
  schedules: InventoryProductSaleSchedule[],
  from: string,
  excludedMonthKey: string | null
): SaleOpportunity | null {
  if (!schedules.length) return null;
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const fromMonthKey = from.slice(0, 7);
  const candidates: SaleOpportunity[] = [];

  for (let yearOffset = 0; yearOffset <= 2; yearOffset += 1) {
    const year = fromYear + yearOffset;
    schedules.forEach((schedule) => {
      if (yearOffset === 0 && schedule.sale_month < fromMonth) return;
      const date = recurringDate(year, schedule.sale_month, schedule.sale_day);
      const monthKey = date.slice(0, 7);
      const validThrough = monthEnd(date);
      if (monthKey === excludedMonthKey) return;
      if (monthKey < fromMonthKey || validThrough < from) return;
      candidates.push({ schedule, opportunityOn: date, validThrough, monthKey });
    });
  }
  candidates.sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey) ||
    a.opportunityOn.localeCompare(b.opportunityOn) ||
    a.schedule.name.localeCompare(b.schedule.name, "ko-KR")
  );
  return candidates[0] || null;
}

function calculateSeasonality(
  actual: ActualEvidence,
  today: string
): SeasonalityStats {
  const completeMonths = completeCalendarMonths(actual.observationStartedOn, today);
  const empty: SeasonalityStats = {
    status: "observing",
    completeMonthCount: completeMonths.length,
    actualRecordCount: actual.actualRecordCount,
    highestRollingThreeMonthAverage: null,
    lowestRollingThreeMonthAverage: null,
    monthlyShares: null
  };
  if (completeMonths.length < 12 || actual.actualRecordCount < 2) return empty;

  const recentMonths = completeMonths.slice(-12);
  const byMonth = new Map(
    actual.monthlyActuals.map((month) => [month.month, month.packageCount])
  );
  const values = recentMonths.map((month) => byMonth.get(month) || 0);
  const rolling: number[] = [];
  for (let index = 0; index <= values.length - 3; index += 1) {
    rolling.push((values[index] + values[index + 1] + values[index + 2]) / 3);
  }
  const highest = Math.max(...rolling);
  const lowest = Math.min(...rolling);
  const qualified = highest > 0 && (lowest === 0 || highest >= lowest * 2);
  if (!qualified) {
    return {
      ...empty,
      status: "not_seasonal",
      highestRollingThreeMonthAverage: highest,
      lowestRollingThreeMonthAverage: lowest
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const monthlyShares = Array.from({ length: 12 }, () => 0);
  recentMonths.forEach((month, index) => {
    monthlyShares[Number(month.slice(5, 7)) - 1] = values[index] / total;
  });
  return {
    ...empty,
    status: "qualified",
    highestRollingThreeMonthAverage: highest,
    lowestRollingThreeMonthAverage: lowest,
    monthlyShares
  };
}

function decrementMonthlyActuals(
  product: InventoryProduct,
  samples: Array<{ date: string; amount: number }>
): MonthlyConsumptionActual[] {
  const byMonth = new Map<string, MonthlyConsumptionActual>();
  samples.forEach((sample) => {
    const month = sample.date.slice(0, 7);
    const current = byMonth.get(month) || {
      month,
      amount: 0,
      packageCount: 0,
      sampleCount: 0
    };
    current.packageCount += sample.amount;
    current.amount += product.package_size
      ? sample.amount * product.package_size
      : sample.amount;
    current.sampleCount += 1;
    byMonth.set(month, current);
  });
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

function cycleMonthlyActuals(
  product: InventoryProduct,
  cycles: UsageCycle[]
): MonthlyConsumptionActual[] {
  const byMonth = new Map<string, MonthlyConsumptionActual>();
  cycles.forEach((cycle) => {
    const duration = usageCycleDurationDays(cycle.opened_on, cycle.finished_on);
    const people = Math.max(1, cycle.consumer_count || 1);
    const packagePerDay = 1 / people / duration;
    const packageSize = cycle.package_size && cycle.capacity_unit &&
      product.capacity_unit === cycle.capacity_unit
      ? cycle.package_size
      : product.package_size;
    const touched = new Set<string>();
    for (let date = cycle.opened_on; date <= cycle.finished_on; date = addDays(date, 1)) {
      const month = date.slice(0, 7);
      const current = byMonth.get(month) || {
        month,
        amount: 0,
        packageCount: 0,
        sampleCount: 0
      };
      current.packageCount += packagePerDay;
      current.amount += packageSize ? packagePerDay * packageSize : packagePerDay;
      if (!touched.has(month)) {
        current.sampleCount += 1;
        touched.add(month);
      }
      byMonth.set(month, current);
    }
  });
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

function completeCalendarMonths(
  observationStartedOn: string | null,
  today: string
): string[] {
  if (!observationStartedOn) return [];
  let month = firstDayOfNextMonth(observationStartedOn);
  const currentMonth = today.slice(0, 7) + "-01";
  const result: string[] = [];
  while (month < currentMonth) {
    result.push(month.slice(0, 7));
    month = firstDayOfNextMonth(month);
  }
  return result;
}

function observationDaysForCycles(cycles: UsageCycle[]): number | null {
  if (!cycles.length) return null;
  const earliest = cycles.reduce(
    (value, cycle) => cycle.opened_on < value ? cycle.opened_on : value,
    cycles[0].opened_on
  );
  const latest = cycles.reduce(
    (value, cycle) => cycle.finished_on > value ? cycle.finished_on : value,
    cycles[0].finished_on
  );
  return usageCycleDurationDays(earliest, latest);
}

function firstDayOfNextMonth(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function monthEnd(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function daysInMonth(iso: string): number {
  return Number(monthEnd(iso).slice(8, 10));
}

function recurringDate(year: number, month: number, day: number): string {
  const first = String(year).padStart(4, "0") + "-" +
    String(month).padStart(2, "0") + "-01";
  const safeDay = Math.min(day, daysInMonth(first));
  return first.slice(0, 8) + String(safeDay).padStart(2, "0");
}
