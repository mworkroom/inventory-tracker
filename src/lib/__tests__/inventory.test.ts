import assert from "node:assert/strict";
import test from "node:test";
import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  UsageCycle
} from "../../types";
import {
  calculateConsumptionStats,
  calculateProductAnalysis,
  calculateStockCheckUsage,
  calculatePurchaseStats,
  estimateProduct,
  formatDate,
  formatDateInput,
  getInventoryAttentionKind,
  isInventoryAttentionNeeded,
  isRepurchaseDue,
  median,
  parseDateInput,
  parsePurchaseDates,
  previewInventoryEventMutation,
  usageCycleDurationDays
} from "../inventory";
import {
  attachProductStoreIds,
  getProductStoreIds
} from "../inventoryStores";
import { groupByStore } from "../../hooks/useInventoryViewModel";
import {
  formatActiveMeta,
  formatConsumptionAmount,
  formatPurchaseForecast
} from "../productPresentation";

const baseProduct: InventoryProduct = {
  id: "product-1",
  workspace_id: "workspace-1",
  name: "테스트",
  tracking_mode: "cycle",
  unit_label: "통",
  package_size: 1600,
  capacity_unit: "ml",
  current_quantity: 1,
  stock_initialized: true,
  low_stock_threshold: 0,
  alert_days: 30,
  current_consumer_count: 1,
  active_opened_on: null,
  active_consumer_count: null,
  preferred_store_id: null,
  next_sale_on: null,
  purchase_coverage_months: null,
  purchase_safety_quantity: 0,
  active_months: null,
  notes: null,
  is_archived: false,
  created_by: null,
  updated_by: null,
  created_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:00:00Z"
};

test("기존 주구매처는 쇼핑몰 연결이 없을 때 단일 쇼핑몰로 유지한다", () => {
  assert.deepEqual(
    getProductStoreIds({
      ...baseProduct,
      preferred_store_id: "store-legacy"
    }),
    ["store-legacy"]
  );
});

test("복수 쇼핑몰 연결을 제품에 합치고 쇼핑몰별 그룹에 각각 표시한다", () => {
  const stores = [
    {
      id: "store-coupang",
      workspace_id: "workspace-1",
      name: "쿠팡",
      sort_order: 10,
      is_active: true,
      created_by: null,
      created_at: "2026-07-19T00:00:00Z"
    },
    {
      id: "store-kurly",
      workspace_id: "workspace-1",
      name: "마켓컬리",
      sort_order: 30,
      is_active: true,
      created_by: null,
      created_at: "2026-07-19T00:00:00Z"
    }
  ];
  const [product] = attachProductStoreIds(
    [baseProduct],
    [
      {
        workspace_id: "workspace-1",
        product_id: baseProduct.id,
        store_id: "store-kurly",
        created_by: null,
        created_at: "2026-07-19T00:00:00Z"
      },
      {
        workspace_id: "workspace-1",
        product_id: baseProduct.id,
        store_id: "store-coupang",
        created_by: null,
        created_at: "2026-07-19T00:00:00Z"
      }
    ],
    stores
  );

  assert.deepEqual(product.store_ids, ["store-coupang", "store-kurly"]);
  assert.deepEqual(
    groupByStore(product ? [product] : [], new Map(stores.map((store) => [store.id, store])))
      .map((group) => [group.name, group.products.map((item) => item.id)]),
    [
      ["쿠팡", [baseProduct.id]],
      ["마켓컬리", [baseProduct.id]]
    ]
  );
});

function cycle(overrides: Partial<UsageCycle> = {}): UsageCycle {
  return {
    id: "cycle-1",
    workspace_id: "workspace-1",
    product_id: "product-1",
    opened_on: "2026-05-01",
    finished_on: "2026-07-15",
    duration_days: 76,
    package_size: 1600,
    capacity_unit: "ml",
    consumer_count: 2,
    created_by: null,
    created_at: "2026-07-15T00:00:00Z",
    ...overrides
  };
}

function useEvent(date: string, amount = 1): InventoryEvent {
  return {
    id: `event-${date}`,
    workspace_id: "workspace-1",
    product_id: "product-1",
    event_type: "use",
    quantity_delta: -amount,
    quantity_before: 10,
    quantity_after: 10 - amount,
    occurred_on: date,
    consumer_count: null,
    note: null,
    created_by: null,
    created_at: `${date}T00:00:00Z`
  };
}

function intakeEvent(date: string, amount = 1): InventoryEvent {
  return {
    ...useEvent(date, amount),
    id: `intake-${date}`,
    event_type: "intake",
    quantity_delta: amount,
    quantity_before: 0,
    quantity_after: amount
  };
}

function purchase(
  date: string,
  overrides: Partial<InventoryPurchase> = {}
): InventoryPurchase {
  return {
    id: overrides.id || `purchase-${date}`,
    workspace_id: "workspace-1",
    product_id: "product-1",
    store_id: "store-1",
    purchased_on: date,
    package_count: 1,
    package_size: 5000,
    package_unit: "g",
    total_price: null,
    shipping_fee: null,
    note: null,
    created_by: null,
    updated_by: null,
    created_at: `${date}T00:00:00Z`,
    updated_at: `${date}T00:00:00Z`,
    ...overrides
  };
}

test("두 명이 76일 쓴 1600ml 제품은 한 명 기준 약 152일로 보정한다", () => {
  const estimate = estimateProduct(baseProduct, [], [cycle()], "2026-07-19");
  assert.equal(estimate.expectedCycleDays, 152);
  assert.equal(estimate.remainingDays, 152);
  assert.ok(estimate.perPersonDailyCapacity);
  assert.ok(Math.abs((estimate.perPersonDailyCapacity || 0) - 10.5263) < 0.001);
});

test("개봉 후 지난 기간과 미개봉 1통을 각각 남은 기간에 반영한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    current_quantity: 2,
    active_opened_on: "2026-04-12",
    active_consumer_count: 1
  };
  const estimate = estimateProduct(
    product,
    [],
    [cycle({ duration_days: 160, consumer_count: 1 })],
    "2026-07-19"
  );
  assert.equal(estimate.expectedCycleDays, 160);
  assert.equal(estimate.remainingDays, 62 + 160);
});

test("쓸 때마다 수량 줄이기는 최근 사용 간격의 중앙값으로 남은 기간을 계산한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    tracking_mode: "count",
    unit_label: "인분",
    package_size: null,
    capacity_unit: null,
    current_quantity: 4
  };
  const events = [useEvent("2026-07-01"), useEvent("2026-07-09"), useEvent("2026-07-17")];
  const estimate = estimateProduct(product, events, [], "2026-07-19");
  assert.equal(estimate.daysPerUnit, 8);
  assert.equal(estimate.remainingDays, 32);
});

test("남은 수량 확인은 앱 재고와 실제 잔량의 차이를 사용량으로 계산한다", () => {
  assert.equal(calculateStockCheckUsage(8, "3"), 5);
  assert.throws(
    () => calculateStockCheckUsage(8, "9"),
    /입고 또는 재고 정정/
  );
  assert.throws(
    () => calculateStockCheckUsage(8, "8"),
    /현재 앱 재고와 같습니다/
  );
  assert.throws(
    () => calculateStockCheckUsage(8, ""),
    /실제 남은 수량을 입력/
  );
});

test("재고 수량 기준과 예상 소진일 기준 모두 구매 필요를 표시한다", () => {
  assert.equal(estimateProduct({ ...baseProduct, current_quantity: 1, low_stock_threshold: 1 }, [], [], "2026-07-19").isUrgent, true);
  assert.equal(estimateProduct({ ...baseProduct, current_quantity: 1, low_stock_threshold: 0, alert_days: 160 }, [], [cycle()], "2026-07-19").isUrgent, true);
});

test("과거 사용 주기는 개봉일과 소진일을 모두 포함해 기간을 계산한다", () => {
  assert.equal(usageCycleDurationDays("2026-04-12", "2026-06-26"), 76);
});

test("재고 미설정 제품은 0개로 오해해 구매 필요를 표시하지 않는다", () => {
  const estimate = estimateProduct(
    { ...baseProduct, current_quantity: 0, stock_initialized: false, low_stock_threshold: 1 },
    [],
    [],
    "2026-07-19"
  );
  assert.equal(estimate.isUrgent, false);
  assert.equal(estimate.remainingDays, null);
  assert.equal(estimate.forecastSource, null);
});

test("사용 기록이 없으면 과거 구매 간격을 임시 예상으로 사용한다", () => {
  const purchases = [
    purchase("2024-01-10"),
    purchase("2024-05-18"),
    purchase("2024-10-02"),
    purchase("2025-02-11"),
    purchase("2025-07-06")
  ];
  const stats = calculatePurchaseStats(
    "product-1",
    purchases,
    [],
    "2025-07-20"
  );
  const estimate = estimateProduct(
    { ...baseProduct, current_quantity: 0, stock_initialized: false, alert_days: 130 },
    [],
    [],
    "2025-07-20",
    stats
  );
  assert.equal(estimate.forecastSource, "purchase_interval");
  assert.equal(estimate.estimatedOutDate, "2025-11-18");
  assert.equal(estimate.remainingDays, 121);
  assert.equal(estimate.isUrgent, true);
});

test("중앙값은 튀는 사용 기록 하나의 영향을 줄인다", () => {
  assert.equal(median([48, 92, 51, 53]), 52);
});

test("과거 구매일의 최근 간격 중앙값으로 다음 구매일을 계산한다", () => {
  const purchases = [purchase("2024-01-10"), purchase("2024-05-18"), purchase("2024-10-02"), purchase("2025-02-11"), purchase("2025-07-06")];
  const stats = calculatePurchaseStats(
    "product-1",
    purchases,
    [],
    "2025-07-20"
  );
  assert.equal(stats.purchaseDateCount, 5);
  assert.equal(stats.medianIntervalDays, 134.5);
  assert.equal(stats.nextPurchaseDate, "2025-11-18");
  assert.equal(stats.daysUntilNextPurchase, 121);
});

test("같은 날 여러 번 산 기록은 구매 간격 날짜 하나로 계산한다", () => {
  const stats = calculatePurchaseStats(
    "product-1",
    [
      purchase("2025-01-01"),
      purchase("2025-01-01", { id: "same-day-2" }),
      purchase("2025-02-01")
    ],
    [],
    "2025-02-02"
  );
  assert.equal(stats.purchaseDateCount, 2);
  assert.equal(stats.medianIntervalDays, 31);
});

test("실제 구매일과 입고일은 별도로 집계한다", () => {
  const stats = calculatePurchaseStats(
    "product-1",
    [purchase("2025-01-01"), purchase("2025-02-01")],
    [intakeEvent("2025-02-01"), intakeEvent("2025-03-01")],
    "2025-03-02"
  );
  assert.equal(stats.purchaseRecordCount, 2);
  assert.equal(stats.purchaseDateCount, 2);
  assert.equal(stats.medianIntervalDays, 31);
  assert.equal(stats.lastPurchasedOn, "2025-02-01");
  assert.equal(stats.latestIntakeOn, "2025-03-01");
  assert.equal(stats.latestIntakeQuantity, 1);
  assert.equal(stats.nextPurchaseDate, "2025-03-04");
});

test("과거 구매 수량과 제품 용량으로 월평균 소비량을 추정한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    name: "허블룸 콤부차 세럼",
    package_size: 50,
    capacity_unit: "ml",
    current_quantity: 2
  };
  const purchases = [
    purchase("2022-10-02", { package_size: null, package_unit: null }),
    purchase("2023-07-06", { id: "2023-a", package_size: null, package_unit: null }),
    purchase("2023-07-06", { id: "2023-b", package_size: null, package_unit: null }),
    purchase("2023-11-23", { package_count: 2, package_size: 50, package_unit: "ml" }),
    purchase("2024-04-05", { package_count: 2, package_size: 50, package_unit: "ml" }),
    purchase("2024-04-11", { package_size: null, package_unit: null }),
    purchase("2024-10-25", { package_count: 4, package_size: 50, package_unit: "ml" }),
    purchase("2025-11-13", { package_count: 4, package_size: 50, package_unit: "ml" })
  ];
  const events = [intakeEvent("2026-04-03", 2)];
  const estimate = estimateProduct(product, events, [], "2026-08-15");
  const stats = calculateConsumptionStats(
    product,
    purchases,
    events,
    estimate,
    "2026-08-15"
  );

  assert.equal(stats.source, "purchase");
  assert.equal(stats.observationDays, 1279);
  assert.equal(stats.sampleCount, 8);
  assert.equal(stats.inferredSizeRecordCount, 4);
  assert.ok(Math.abs((stats.monthlyAmount || 0) - 19.038) < 0.01);
  assert.ok(Math.abs((stats.annualAmount || 0) - 228.456) < 0.02);
});

test("실제 사용 주기가 있으면 과거 구매량보다 우선한다", () => {
  const estimate = estimateProduct(baseProduct, [], [cycle()], "2026-07-19");
  const purchases = ["2024-01-01", "2024-10-01", "2025-07-01"].map(
    (date, index) => purchase(date, {
      id: `usage-priority-${index}`,
      package_count: 20,
      package_size: 1600,
      package_unit: "ml"
    })
  );
  const stats = calculateConsumptionStats(
    baseProduct,
    purchases,
    [],
    estimate,
    "2026-07-19"
  );
  const analysis = calculateProductAnalysis(
    baseProduct,
    purchases,
    [],
    [cycle()],
    null,
    "2026-07-19"
  );

  assert.equal(stats.source, "usage");
  assert.equal(stats.sampleCount, 1);
  assert.ok(Math.abs((stats.monthlyAmount || 0) - 320.3947) < 0.01);
  assert.equal(analysis.estimate.forecastSource, "usage");
});

test("세일 날짜의 예상 재고를 빼고 여유 재고를 더해 추천 구매 수량을 계산한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    package_size: 50,
    capacity_unit: "ml",
    current_quantity: 2,
    next_sale_on: "2026-11-27",
    purchase_coverage_months: 12,
    purchase_safety_quantity: 1
  };
  const purchases = [
    purchase("2022-10-02", { package_count: 16, package_size: 50, package_unit: "ml" })
  ];
  const events = [intakeEvent("2026-04-03", 2)];
  const estimate = estimateProduct(product, events, [], "2026-08-15");
  const stats = calculateConsumptionStats(product, purchases, events, estimate, "2026-08-15");

  assert.equal(stats.recommendedPurchaseQuantity, 5);
  assert.ok(Math.abs((stats.expectedStockOnSaleDate || 0) - 0.699) < 0.02);
});

test("계절 제품은 연평균과 사용 월 평균을 나누고 활성 월만 구매량에 반영한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    package_size: 50,
    capacity_unit: "ml",
    current_quantity: 1,
    active_months: [6, 7, 8],
    next_sale_on: "2026-05-15",
    purchase_coverage_months: 4,
    purchase_safety_quantity: 0
  };
  const purchases = [
    purchase("2025-01-01", {
      package_count: 3,
      package_size: 50,
      package_unit: "ml"
    })
  ];
  const events = [intakeEvent("2026-01-01", 1)];
  const estimate = estimateProduct(product, events, [], "2026-01-01");
  const stats = calculateConsumptionStats(
    product,
    purchases,
    events,
    estimate,
    "2026-01-01"
  );

  assert.ok(Math.abs((stats.monthlyPackageCount || 0) - 0.25) < 0.01);
  assert.ok(Math.abs((stats.activeMonthlyPackageCount || 0) - 0.99) < 0.02);
  assert.ok(Math.abs((stats.annualPackageCount || 0) - 3) < 0.01);
  assert.equal(stats.nextSeasonStartOn, "2026-06-01");
  assert.equal(stats.nextSeasonEndOn, "2026-08-31");
  assert.equal(stats.recommendedPurchaseQuantity, 2);
});

test("계절 제품의 소진 예상일은 비사용 월을 건너뛴다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    tracking_mode: "count",
    unit_label: "통",
    package_size: null,
    capacity_unit: null,
    current_quantity: 1,
    active_months: [6, 7, 8]
  };
  const events = [
    useEvent("2026-06-01"),
    useEvent("2026-07-01")
  ];
  const estimate = estimateProduct(product, events, [], "2026-08-31");

  assert.equal(estimate.daysPerUnit, 30);
  assert.equal(estimate.estimatedOutDate, "2027-06-30");
  assert.equal(estimate.remainingDays, 303);
});

test("과거 입고 수량을 수정하면 뒤에 입력한 재고 기록까지 다시 계산한다", () => {
  const first = {
    ...intakeEvent("2026-04-06", 2),
    id: "intake-first",
    created_at: "2026-08-15T05:24:06Z"
  };
  const second = {
    ...intakeEvent("2026-04-06", 1),
    id: "intake-second",
    quantity_before: 2,
    quantity_after: 3,
    created_at: "2026-08-15T05:26:40Z"
  };
  const preview = previewInventoryEventMutation(
    { ...baseProduct, current_quantity: 3 },
    [second, first],
    first.id,
    3
  );

  assert.deepEqual(preview, {
    nextQuantity: 4,
    followingEventCount: 1,
    error: null
  });
});

test("보정용 입고 기록을 삭제하면 남은 원장 기준 현재 재고를 계산한다", () => {
  const first = {
    ...intakeEvent("2026-04-06", 2),
    id: "intake-first",
    created_at: "2026-08-15T05:24:06Z"
  };
  const second = {
    ...intakeEvent("2026-04-06", 1),
    id: "intake-second",
    quantity_before: 2,
    quantity_after: 3,
    created_at: "2026-08-15T05:26:40Z"
  };
  const preview = previewInventoryEventMutation(
    { ...baseProduct, current_quantity: 3 },
    [first, second],
    second.id,
    null
  );

  assert.deepEqual(preview, {
    nextQuantity: 2,
    followingEventCount: 0,
    error: null
  });
});

test("재고 정정 기록은 과거 수량 수정 후에도 당시 실제 재고 기준점을 유지한다", () => {
  const intake = {
    ...intakeEvent("2026-04-01", 2),
    id: "intake-first",
    created_at: "2026-04-01T00:00:00Z"
  };
  const adjustment: InventoryEvent = {
    ...intakeEvent("2026-04-02", 1),
    id: "adjustment-later",
    event_type: "adjustment",
    quantity_delta: -1,
    quantity_before: 2,
    quantity_after: 1,
    created_at: "2026-04-02T00:00:00Z"
  };
  const preview = previewInventoryEventMutation(
    { ...baseProduct, current_quantity: 1 },
    [intake, adjustment],
    intake.id,
    3
  );

  assert.equal(preview.nextQuantity, 1);
  assert.equal(preview.error, null);
});

test("미국식 날짜 입력은 ISO로 정규화하고 화면에는 미국식으로 표시한다", () => {
  assert.equal(parseDateInput("2/10/2024"), "2024-02-10");
  assert.equal(parseDateInput("02/10/2024"), "2024-02-10");
  assert.equal(parseDateInput("2024-02-10"), "2024-02-10");
  assert.equal(parseDateInput("2/30/2024"), null);
  assert.equal(formatDateInput("2024-02-10"), "2/10/2024");
  assert.equal(formatDate("2024-02-10"), "2/10/2024");
});

test("과거 구매일 붙여넣기는 미국식과 기존 날짜 형식을 정규화하고 중복을 제거한다", () => {
  assert.deepEqual(parsePurchaseDates("2/10/2024\n06/21/2024\n2024년 11월 3일\n2024-02-10", "2025-01-01"), ["2024-02-10", "2024-06-21", "2024-11-03"]);
});

test("잘못된 날짜와 미래 날짜는 과거 구매일 입력에서 거부한다", () => {
  assert.throws(() => parsePurchaseDates("2024-02-30", "2025-01-01"), /날짜 형식/);
  assert.throws(() => parsePurchaseDates("2026-01-01", "2025-01-01"), /날짜 형식/);
});

test("구매 예상일은 재고·소진 알림과 별도의 재구매 신호로 분류한다", () => {
  const product = {
    ...baseProduct,
    current_quantity: 3,
    low_stock_threshold: 0,
    alert_days: 130
  };
  const stats = calculatePurchaseStats(
    "product-1",
    [
      purchase("2024-01-10"),
      purchase("2024-05-18"),
      purchase("2024-10-02"),
      purchase("2025-02-11"),
      purchase("2025-07-06")
    ],
    [],
    "2025-07-20"
  );
  const estimate = estimateProduct(product, [], [], "2025-07-20", stats);

  assert.equal(estimate.forecastSource, "purchase_interval");
  assert.equal(getInventoryAttentionKind(product, estimate), null);
  assert.equal(isRepurchaseDue(product, stats, estimate), true);
  assert.equal(isInventoryAttentionNeeded(product, estimate, stats), true);
});

test("현재 수량과 실제 사용 속도는 재고·소진 알림으로 분류한다", () => {
  const quantityProduct = {
    ...baseProduct,
    current_quantity: 1,
    low_stock_threshold: 1
  };
  const quantityEstimate = estimateProduct(quantityProduct, [], [], "2026-07-19");
  const noPurchaseStats = calculatePurchaseStats(
    "product-1",
    [],
    [],
    "2026-07-19"
  );
  assert.equal(getInventoryAttentionKind(quantityProduct, quantityEstimate), "quantity");
  assert.equal(
    isInventoryAttentionNeeded(
      quantityProduct,
      quantityEstimate,
      noPurchaseStats
    ),
    true
  );

  const usageProduct = {
    ...baseProduct,
    current_quantity: 1,
    low_stock_threshold: 0,
    alert_days: 160
  };
  const usageEstimate = estimateProduct(
    usageProduct,
    [],
    [cycle()],
    "2026-07-19"
  );
  assert.equal(usageEstimate.forecastSource, "usage");
  assert.equal(getInventoryAttentionKind(usageProduct, usageEstimate), "depletion");
});

test("충분한 과거 구매량이 있으면 1통 수량 기준보다 소진 예측을 우선한다", () => {
  const product = {
    ...baseProduct,
    name: "더랩 히알루론산 토너",
    package_size: 500,
    capacity_unit: "ml",
    current_quantity: 1,
    low_stock_threshold: 1,
    alert_days: 30
  };
  const purchases = ["2024-01-01", "2024-09-01", "2025-05-01"].map(
    (date, index) => purchase(date, {
      id: `toner-${index}`,
      package_size: 500,
      package_unit: "ml"
    })
  );
  const events = [intakeEvent("2026-01-01", 1)];
  const stats = calculatePurchaseStats(
    product.id,
    purchases,
    events,
    "2026-01-02"
  );
  const analysis = calculateProductAnalysis(
    product,
    purchases,
    events,
    [],
    stats,
    "2026-01-02"
  );

  assert.equal(analysis.consumptionStats.source, "purchase");
  assert.ok(Math.abs((analysis.consumptionStats.annualPackageCount || 0) - 1.5) < 0.01);
  assert.equal(analysis.estimate.forecastSource, "purchase_volume");
  assert.ok((analysis.estimate.remainingDays || 0) > 200);
  assert.equal(getInventoryAttentionKind(product, analysis.estimate), null);
  assert.equal(isRepurchaseDue(product, stats, analysis.estimate), false);
  assert.equal(analysis.estimate.isUrgent, false);
});

test("구매량 기반 소진일이 가까우면 구매 간격보다 소진 임박을 표시한다", () => {
  const product = {
    ...baseProduct,
    name: "Oats Thick",
    package_size: 500,
    capacity_unit: "g",
    current_quantity: 1,
    low_stock_threshold: 0,
    alert_days: 100
  };
  const purchases = ["2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01"].map(
    (date, index) => purchase(date, { id: `oats-${index}` })
  );
  const events = [intakeEvent("2026-01-01", 1)];
  const stats = calculatePurchaseStats(
    product.id,
    purchases,
    events,
    "2026-01-02"
  );
  const analysis = calculateProductAnalysis(
    product,
    purchases,
    events,
    [],
    stats,
    "2026-01-02"
  );

  assert.equal(analysis.estimate.forecastSource, "purchase_volume");
  assert.equal(getInventoryAttentionKind(product, analysis.estimate), "depletion");
  assert.equal(isRepurchaseDue(product, stats, analysis.estimate), false);
  assert.match(analysis.estimate.urgentReason || "", /과거 구매량/);
});

test("구매량 근거가 부족하면 기존 수량 안전망을 사용한다", () => {
  const product = {
    ...baseProduct,
    current_quantity: 1,
    low_stock_threshold: 1
  };
  const purchases = ["2025-10-01", "2025-12-01"].map((date, index) =>
    purchase(date, {
      id: `short-history-${index}`,
      package_size: 1600,
      package_unit: "ml"
    })
  );
  const events = [intakeEvent("2026-01-01", 1)];
  const analysis = calculateProductAnalysis(
    product,
    purchases,
    events,
    [],
    null,
    "2026-01-02"
  );

  assert.notEqual(analysis.estimate.forecastSource, "purchase_volume");
  assert.equal(getInventoryAttentionKind(product, analysis.estimate), "quantity");
});

test("제품 카드 보충 정보는 괄호를 쓰고 날짜 뒤 정보는 쉼표로 구분한다", () => {
  assert.equal(
    formatConsumptionAmount(
      {
        source: "purchase",
        monthlyAmount: 24.77,
        monthlyUnit: "ml",
        monthlyPackageCount: 0.5,
        activeMonthlyAmount: 24.77,
        activeMonthlyPackageCount: 0.5,
        annualAmount: 297.24,
        annualPackageCount: 6,
        nextSeasonStartOn: null,
        nextSeasonEndOn: null,
        nextSeasonAmount: null,
        nextSeasonPackageCount: null,
        sampleCount: 8,
        observationDays: 365,
        inferredSizeRecordCount: 0,
        excludedSizeRecordCount: 0,
        recommendedPurchaseQuantity: 6,
        expectedStockOnSaleDate: 1
      },
      "통"
    ),
    "약 24.77ml/월 (약 0.5통/월)"
  );
  assert.equal(formatPurchaseForecast("2026-04-03", 12), "4/3/2026, 12일 후");
  assert.equal(
    formatActiveMeta({
      ...baseProduct,
      active_opened_on: "2026-04-03",
      active_consumer_count: 2
    }),
    "4/3/2026, 2명 사용"
  );
});
