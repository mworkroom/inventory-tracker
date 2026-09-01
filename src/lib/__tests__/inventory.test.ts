import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  calculatePurchaseStats,
  calculateStockCheckUsage,
  daysBetween,
  parseDateInput,
  parsePurchaseDates,
  previewInventoryEventMutation,
  usageCycleDurationDays
} from "../inventory";
import {
  calculateConsumptionStats,
  calculateProductAnalysis,
  estimateProduct,
  getInventoryAttentionKind,
  isInventoryAttentionNeeded,
  isRepurchaseDue,
  usageTrackingOf
} from "../observationAnalysis";
import type {
  InventoryConsumptionBaseline,
  InventoryEvent,
  InventoryProduct,
  InventoryProductSaleSchedule,
  InventoryPurchase,
  PurchaseStats,
  UsageCycle
} from "../../types";

const baseProduct: InventoryProduct = {
  id: "product-1",
  workspace_id: "workspace-1",
  name: "세라 크림",
  category: "화장품",
  tracking_mode: "cycle",
  usage_tracking: "cycle",
  usage_tracking_changed_on: null,
  unit_label: "통",
  package_size: 50,
  capacity_unit: "ml",
  current_quantity: 2,
  stock_initialized: true,
  low_stock_threshold: 1,
  alert_days: 30,
  current_consumer_count: 1,
  active_opened_on: null,
  active_consumer_count: null,
  preferred_store_id: null,
  store_ids: [],
  next_sale_on: null,
  purchase_coverage_months: null,
  purchase_safety_quantity: 0,
  active_months: null,
  notes: null,
  is_archived: false,
  created_by: null,
  updated_by: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z"
};

function cycle(overrides: Partial<UsageCycle> = {}): UsageCycle {
  return {
    id: "cycle-1",
    workspace_id: "workspace-1",
    product_id: baseProduct.id,
    opened_on: "2026-06-01",
    finished_on: "2026-06-30",
    duration_days: 30,
    package_size: 50,
    capacity_unit: "ml",
    consumer_count: 1,
    created_by: null,
    created_at: "2026-06-30T00:00:00Z",
    ...overrides
  };
}

function event(
  occurredOn: string,
  amount: number,
  overrides: Partial<InventoryEvent> = {}
): InventoryEvent {
  return {
    id: "event-" + occurredOn + "-" + amount,
    workspace_id: "workspace-1",
    product_id: baseProduct.id,
    event_type: "use",
    quantity_delta: -Math.abs(amount),
    quantity_before: 20,
    quantity_after: 20 - Math.abs(amount),
    occurred_on: occurredOn,
    consumer_count: null,
    note: null,
    created_by: null,
    created_at: occurredOn + "T12:00:00Z",
    ...overrides
  };
}

function baseline(
  overrides: Partial<InventoryConsumptionBaseline> = {}
): InventoryConsumptionBaseline {
  return {
    id: "baseline-1",
    workspace_id: "workspace-1",
    product_id: baseProduct.id,
    usage_tracking: "cycle",
    started_on: "2026-01-01",
    ended_on: "2026-01-30",
    consumed_quantity: 1,
    quantity_unit: "통",
    package_size: 50,
    capacity_unit: "ml",
    consumer_count: 1,
    note: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-01-30T00:00:00Z",
    updated_at: "2026-01-30T00:00:00Z",
    ...overrides
  };
}

function saleSchedule(
  id: string,
  month: number,
  day: number,
  overrides: Partial<InventoryProductSaleSchedule> = {}
): InventoryProductSaleSchedule {
  return {
    id,
    workspace_id: "workspace-1",
    product_id: baseProduct.id,
    store_id: "store-1",
    name: "정기 세일",
    sale_month: month,
    sale_day: day,
    created_by: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

const emptyPurchaseStats: PurchaseStats = {
  purchaseRecordCount: 0,
  purchaseDateCount: 0,
  totalPackageCount: 0,
  intervalSampleCount: 0,
  medianIntervalDays: null,
  firstPurchasedOn: null,
  lastPurchasedOn: null,
  lastPurchasePackageCount: null,
  latestIntakeOn: null,
  latestIntakeQuantity: null,
  nextPurchaseDate: null,
  daysUntilNextPurchase: null
};

test("stock check records only a known decrease", () => {
  assert.equal(calculateStockCheckUsage(10, "7"), 3);
  assert.throws(() => calculateStockCheckUsage(10, "11"), /입고 또는 재고 정정/);
  assert.throws(() => calculateStockCheckUsage(10, "10"), /현재 앱 재고와 같습니다/);
});

test("inventory event preview replays the ledger after an edit", () => {
  const product = { ...baseProduct, usage_tracking: "decrement" as const, tracking_mode: "count" as const, current_quantity: 7 };
  const intake = event("2026-01-01", 10, {
    id: "intake",
    event_type: "intake",
    quantity_delta: 10,
    quantity_before: 0,
    quantity_after: 10,
    created_at: "2026-01-01T00:00:00Z"
  });
  const use = event("2026-01-02", 3, {
    id: "use",
    quantity_before: 10,
    quantity_after: 7,
    created_at: "2026-01-02T00:00:00Z"
  });
  assert.deepEqual(previewInventoryEventMutation(product, [intake, use], "intake", 12), {
    nextQuantity: 9,
    followingEventCount: 1,
    error: null
  });
});

test("date and purchase parsers normalize supported formats", () => {
  assert.equal(parseDateInput("08/31/2026"), "2026-08-31");
  assert.deepEqual(
    parsePurchaseDates("2026-01-02\n03/04/2026", "2026-12-31"),
    ["2026-01-02", "2026-03-04"]
  );
  assert.equal(daysBetween("2026-01-01", "2026-01-11"), 10);
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(usageCycleDurationDays("2026-01-01", "2026-01-01"), 1);
});

test("purchase statistics keep purchase behavior separate from consumption", () => {
  const purchases: InventoryPurchase[] = [
    purchase("purchase-1", "2026-01-01", 2),
    purchase("purchase-2", "2026-01-01", 1),
    purchase("purchase-3", "2026-02-01", 3)
  ];
  const stats = calculatePurchaseStats(baseProduct.id, purchases, [], "2026-02-10");
  assert.equal(stats.purchaseRecordCount, 3);
  assert.equal(stats.purchaseDateCount, 2);
  assert.equal(stats.totalPackageCount, 6);
  assert.equal(stats.medianIntervalDays, 31);
  assert.equal(stats.nextPurchaseDate, "2026-03-04");
});

test("one completed cycle immediately creates an actual-use estimate", () => {
  const estimate = estimateProduct(baseProduct, [], [cycle()], null, "2026-07-01");
  assert.equal(estimate.forecastSource, "usage");
  assert.equal(estimate.isLearning, false);
  assert.equal(estimate.cycleSampleCount, 1);
  assert.equal(estimate.expectedCycleDays, 30);
  assert.equal(estimate.remainingDays, 60);
});

test("cycle observations normalize shared use and package-size changes", () => {
  const estimate = estimateProduct(
    baseProduct,
    [],
    [cycle({ package_size: 25, consumer_count: 2 })],
    null,
    "2026-07-01"
  );
  assert.equal(estimate.expectedCycleDays, 120);
  assert.equal(estimate.perPersonDailyCapacity, 50 / 120);
});

test("decrement tracking requires two distinct use dates", () => {
  const product = decrementProduct({ current_quantity: 5 });
  const first = estimateProduct(product, [event("2026-01-01", 1)], [], null, "2026-01-11");
  assert.equal(first.forecastSource, null);
  assert.equal(first.useSampleCount, 1);

  const ready = estimateProduct(
    product,
    [event("2026-01-01", 1), event("2026-01-11", 1)],
    [],
    null,
    "2026-01-11"
  );
  assert.equal(ready.forecastSource, "usage");
  assert.equal(ready.useSampleCount, 2);
  assert.equal(ready.daysPerUnit, 10);
  assert.equal(ready.remainingDays, 50);
});

test("a recalled baseline starts an estimate but never becomes an actual sample", () => {
  const product = decrementProduct({ current_quantity: 5 });
  const recalled = baseline({
    usage_tracking: "decrement",
    quantity_unit: "개",
    package_size: null,
    capacity_unit: null,
    started_on: "2026-01-01",
    ended_on: "2026-01-10",
    consumed_quantity: 2
  });
  const analysis = calculateProductAnalysis(product, [], [], recalled, [], "2026-01-11");
  assert.equal(analysis.estimate.forecastSource, "recalled_baseline");
  assert.equal(analysis.estimate.remainingDays, 25);
  assert.equal(analysis.consumptionStats.source, "recalled_baseline");
  assert.equal(analysis.consumptionStats.sampleCount, 1);
  assert.equal(analysis.consumptionStats.monthlyActuals.length, 0);
  assert.equal(analysis.consumptionStats.seasonality.actualRecordCount, 0);
});

test("actual use automatically takes priority over a recalled baseline", () => {
  const product = decrementProduct({ current_quantity: 5 });
  const recalled = baseline({
    usage_tracking: "decrement",
    quantity_unit: "개",
    package_size: null,
    capacity_unit: null,
    consumed_quantity: 10
  });
  const analysis = calculateProductAnalysis(
    product,
    [event("2026-01-01", 1), event("2026-01-11", 1)],
    [],
    recalled,
    [],
    "2026-01-11"
  );
  assert.equal(analysis.estimate.forecastSource, "usage");
  assert.equal(analysis.estimate.daysPerUnit, 10);
  assert.equal(analysis.consumptionStats.source, "usage");
});

test("the first actual record is visible by month even while speed is still observing", () => {
  const product = decrementProduct();
  const stats = calculateConsumptionStats(
    product,
    [event("2026-08-15", 2)],
    [],
    null,
    [],
    "2026-08-31"
  );
  assert.equal(stats.source, null);
  assert.deepEqual(stats.monthlyActuals, [{
    month: "2026-08",
    amount: 2,
    packageCount: 2,
    sampleCount: 1
  }]);
});

test("manual active months no longer change annual need", () => {
  const events = [event("2026-01-01", 1), event("2026-01-11", 1)];
  const allYear = calculateConsumptionStats(
    decrementProduct({ active_months: null }),
    events,
    [],
    null,
    [],
    "2026-01-11"
  );
  const legacySeasonal = calculateConsumptionStats(
    decrementProduct({ active_months: [6, 7, 8] }),
    events,
    [],
    null,
    [],
    "2026-01-11"
  );
  assert.equal(legacySeasonal.annualPackageCount, allYear.annualPackageCount);
  assert.equal(legacySeasonal.monthlyPackageCount, allYear.monthlyPackageCount);
});

test("seasonality stays descriptive until twelve complete calendar months exist", () => {
  const stats = calculateConsumptionStats(
    decrementProduct(),
    [event("2025-06-15", 10), event("2025-07-15", 10)],
    [],
    null,
    [],
    "2026-05-01"
  );
  assert.equal(stats.seasonality.status, "observing");
  assert.equal(stats.seasonality.completeMonthCount, 10);
  assert.equal(stats.seasonality.monthlyShares, null);
});

test("a strong observed annual pattern qualifies without changing annual total", () => {
  const product = decrementProduct({ current_quantity: 100 });
  const events = monthlyEvents(true);
  const stats = calculateConsumptionStats(product, events, [], null, [], "2026-02-15");
  assert.equal(stats.seasonality.status, "qualified");
  assert.equal(stats.seasonality.completeMonthCount >= 12, true);
  assert.equal(stats.seasonality.actualRecordCount >= 2, true);
  assert.equal(stats.seasonality.monthlyShares?.length, 12);
  assert.ok(Math.abs((stats.seasonality.monthlyShares || []).reduce((a, b) => a + b, 0) - 1) < 1e-9);

  const recentCompleteYearTotal = stats.monthlyActuals
    .filter((month) => month.month >= "2025-02" && month.month <= "2026-01")
    .reduce((sum, month) => sum + month.packageCount, 0);
  assert.equal(stats.annualPackageCount, recentCompleteYearTotal);
});

test("a flat year is explicitly classified as not seasonal", () => {
  const stats = calculateConsumptionStats(
    decrementProduct(),
    monthlyEvents(false),
    [],
    null,
    [],
    "2026-02-15"
  );
  assert.equal(stats.seasonality.status, "not_seasonal");
  assert.equal(stats.seasonality.monthlyShares, null);
});

test("a sale in the current month remains an active purchase opportunity", () => {
  const product = decrementProduct({ current_quantity: 20, purchase_safety_quantity: 1 });
  const events = [event("2026-06-01", 1), event("2026-06-11", 1)];
  const stats = calculateConsumptionStats(
    product,
    events,
    [],
    null,
    [saleSchedule("june", 6, 1), saleSchedule("september", 9, 1)],
    "2026-06-20"
  );
  assert.equal(stats.saleRecommendation?.opportunityOn, "2026-06-01");
  assert.equal(stats.saleRecommendation?.validThrough, "2026-06-30");
  assert.equal(stats.saleRecommendation?.nextOpportunityOn, "2026-09-01");
  assert.equal(
    isRepurchaseDue(
      product,
      emptyPurchaseStats,
      estimateProduct(product, events, [], null, "2026-06-20"),
      stats,
      "2026-06-20"
    ),
    true
  );
});

test("a recurring sale still creates an alert before consumption is learned", () => {
  const product = decrementProduct({ current_quantity: 5 });
  const stats = calculateConsumptionStats(
    product,
    [],
    [],
    null,
    [saleSchedule("september", 9, 1)],
    "2026-08-20"
  );
  assert.equal(stats.saleRecommendation?.opportunityOn, "2026-09-01");
  assert.equal(stats.saleRecommendation?.recommendedQuantity, null);
  assert.equal(
    isRepurchaseDue(
      product,
      emptyPurchaseStats,
      estimateProduct(product, [], [], null, "2026-08-20"),
      stats,
      "2026-08-20"
    ),
    true
  );
});

test("sale planning separates a temporary minimum from the sale quantity", () => {
  const product = decrementProduct({ current_quantity: 0.1, purchase_safety_quantity: 1 });
  const events = [event("2026-06-01", 1), event("2026-06-11", 1)];
  const stats = calculateConsumptionStats(
    product,
    events,
    [],
    null,
    [saleSchedule("september", 9, 1), saleSchedule("december", 12, 1)],
    "2026-06-20"
  );
  assert.ok((stats.saleRecommendation?.temporaryPurchaseQuantity || 0) > 0);
  assert.ok((stats.saleRecommendation?.recommendedQuantity || 0) > 0);
});

test("purchase interval is only a secondary signal when no consumption estimate exists", () => {
  const product = decrementProduct({ current_quantity: 10 });
  const dueStats = { ...emptyPurchaseStats, daysUntilNextPurchase: 5 };
  const learningEstimate = estimateProduct(product, [], [], null, "2026-06-20");
  assert.equal(isRepurchaseDue(product, dueStats, learningEstimate, null, "2026-06-20"), true);

  const usageEvents = [event("2026-06-01", 1), event("2026-06-11", 1)];
  const usageEstimate = estimateProduct(product, usageEvents, [], null, "2026-06-20");
  assert.equal(isRepurchaseDue(product, dueStats, usageEstimate, null, "2026-06-20"), false);
});

test("attention prefers depletion, then quantity, then purchase timing", () => {
  const product = decrementProduct({ current_quantity: 1, low_stock_threshold: 1 });
  const learningEstimate = estimateProduct(product, [], [], null, "2026-06-20");
  assert.equal(getInventoryAttentionKind(product, learningEstimate), "quantity");
  assert.equal(
    isInventoryAttentionNeeded(product, learningEstimate, emptyPurchaseStats, null),
    true
  );

  const usageEstimate = estimateProduct(
    product,
    [event("2026-06-01", 1), event("2026-06-11", 1)],
    [],
    null,
    "2026-06-20"
  );
  assert.equal(getInventoryAttentionKind(product, usageEstimate), "depletion");
});

test("legacy tracking mode remains a read fallback during rollout", () => {
  assert.equal(usageTrackingOf({ ...baseProduct, usage_tracking: undefined, tracking_mode: "count" }), "decrement");
  assert.equal(usageTrackingOf({ ...baseProduct, usage_tracking: undefined, tracking_mode: "cycle" }), "cycle");
});

function decrementProduct(
  overrides: Partial<InventoryProduct> = {}
): InventoryProduct {
  return {
    ...baseProduct,
    tracking_mode: "count",
    usage_tracking: "decrement",
    unit_label: "개",
    package_size: null,
    capacity_unit: null,
    ...overrides
  };
}

function purchase(id: string, purchasedOn: string, packageCount: number): InventoryPurchase {
  return {
    id,
    workspace_id: "workspace-1",
    product_id: baseProduct.id,
    store_id: "store-1",
    purchased_on: purchasedOn,
    package_count: packageCount,
    package_size: null,
    package_unit: null,
    total_price: null,
    shipping_fee: null,
    note: null,
    created_by: null,
    updated_by: null,
    created_at: purchasedOn + "T00:00:00Z",
    updated_at: purchasedOn + "T00:00:00Z"
  };
}

function monthlyEvents(seasonal: boolean): InventoryEvent[] {
  const months: Array<[string, number]> = [["2024-12-15", 1]];
  for (let year = 2025; year <= 2026; year += 1) {
    const finalMonth = year === 2026 ? 1 : 12;
    for (let month = 1; month <= finalMonth; month += 1) {
      const amount = seasonal && month >= 6 && month <= 8 ? 10 : 1;
      months.push([
        String(year) + "-" + String(month).padStart(2, "0") + "-15",
        amount
      ]);
    }
  }
  return months.map(([date, amount], index) => event(date, amount, {
    id: "monthly-" + index,
    quantity_before: 200,
    quantity_after: 200 - amount
  }));
}
