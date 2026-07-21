import assert from "node:assert/strict";
import test from "node:test";
import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  UsageCycle
} from "../../types";
import {
  calculatePurchaseStats,
  estimateProduct,
  median,
  parsePurchaseDates
} from "../inventory";

const baseProduct: InventoryProduct = {
  id: "product-1",
  workspace_id: "workspace-1",
  name: "테스트",
  tracking_mode: "cycle",
  unit_label: "통",
  package_size: 1600,
  capacity_unit: "ml",
  current_quantity: 1,
  low_stock_threshold: 0,
  alert_days: 30,
  current_consumer_count: 1,
  active_opened_on: null,
  active_consumer_count: null,
  active_remaining_quantity: null,
  active_remaining_updated_on: null,
  preferred_store_id: null,
  notes: null,
  is_archived: false,
  created_by: null,
  updated_by: null,
  created_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:00:00Z"
};

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

test("개봉 제품 300ml와 미개봉 1통은 각각 남은 기간에 반영한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    current_quantity: 2,
    active_opened_on: "2026-04-12",
    active_consumer_count: 1,
    active_remaining_quantity: 300,
    active_remaining_updated_on: "2026-07-19"
  };
  const estimate = estimateProduct(
    product,
    [],
    [cycle({ duration_days: 160, consumer_count: 1 })],
    "2026-07-19"
  );
  assert.equal(estimate.expectedCycleDays, 160);
  assert.equal(estimate.remainingDays, 190);
});

test("개수 직접 차감은 최근 사용 간격의 중앙값으로 남은 기간을 계산한다", () => {
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

test("용량 직접 차감도 사용 기록을 기준으로 남은 기간을 계산한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    tracking_mode: "capacity",
    unit_label: "g",
    package_size: null,
    capacity_unit: null,
    current_quantity: 400
  };
  const events = [useEvent("2026-07-01", 100), useEvent("2026-07-09", 100), useEvent("2026-07-17", 100)];
  const estimate = estimateProduct(product, events, [], "2026-07-19");
  assert.equal(estimate.daysPerUnit, 0.08);
  assert.equal(estimate.remainingDays, 32);
});

test("재고 수량 기준과 예상 소진일 기준 모두 구매 필요를 표시한다", () => {
  assert.equal(estimateProduct({ ...baseProduct, current_quantity: 1, low_stock_threshold: 1 }, [], [], "2026-07-19").isUrgent, true);
  assert.equal(estimateProduct({ ...baseProduct, current_quantity: 1, low_stock_threshold: 0, alert_days: 160 }, [], [cycle()], "2026-07-19").isUrgent, true);
});

test("중앙값은 튀는 사용 기록 하나의 영향을 줄인다", () => {
  assert.equal(median([48, 92, 51, 53]), 52);
});

test("과거 구매일의 최근 간격 중앙값으로 다음 구매일을 계산한다", () => {
  const purchases = [purchase("2024-01-10"), purchase("2024-05-18"), purchase("2024-10-02"), purchase("2025-02-11"), purchase("2025-07-06")];
  const stats = calculatePurchaseStats("product-1", purchases, "2025-07-20");
  assert.equal(stats.purchaseCount, 5);
  assert.equal(stats.purchaseDateCount, 5);
  assert.equal(stats.medianIntervalDays, 134.5);
  assert.equal(stats.nextPurchaseDate, "2025-11-18");
  assert.equal(stats.daysUntilNextPurchase, 121);
});

test("같은 날 여러 번 산 기록은 구매 간격 날짜 하나로 계산한다", () => {
  const stats = calculatePurchaseStats("product-1", [purchase("2025-01-01"), purchase("2025-01-01", { id: "same-day-2" }), purchase("2025-02-01")], "2025-02-02");
  assert.equal(stats.purchaseCount, 3);
  assert.equal(stats.purchaseDateCount, 2);
  assert.equal(stats.medianIntervalDays, 31);
});

test("과거 구매일 붙여넣기는 점·하이픈·한글 날짜를 정규화하고 중복을 제거한다", () => {
  assert.deepEqual(parsePurchaseDates("2024-02-10\n2024. 6. 21.\n2024년 11월 3일\n2024-02-10", "2025-01-01"), ["2024-02-10", "2024-06-21", "2024-11-03"]);
});

test("잘못된 날짜와 미래 날짜는 과거 구매일 입력에서 거부한다", () => {
  assert.throws(() => parsePurchaseDates("2024-02-30", "2025-01-01"), /날짜 형식/);
  assert.throws(() => parsePurchaseDates("2026-01-01", "2025-01-01"), /날짜 형식/);
});
