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
  usageCycleDurationDays
} from "../inventory";
import {
  attachProductStoreIds,
  getProductStoreIds
} from "../inventoryStores";
import { groupByStore } from "../../hooks/useInventoryViewModel";

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
  assert.equal(estimate.forecastSource, "purchase");
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
  const stats = calculateConsumptionStats(
    baseProduct,
    [purchase("2024-01-01", { package_count: 20 })],
    [],
    estimate,
    "2026-07-19"
  );

  assert.equal(stats.source, "usage");
  assert.equal(stats.sampleCount, 1);
  assert.ok(Math.abs((stats.monthlyAmount || 0) - 320.3947) < 0.01);
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

  assert.equal(estimate.forecastSource, "purchase");
  assert.equal(getInventoryAttentionKind(product, estimate), null);
  assert.equal(isRepurchaseDue(product, stats), true);
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
  assert.equal(getInventoryAttentionKind(usageProduct, usageEstimate), "usage");
});
