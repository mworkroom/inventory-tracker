import assert from "node:assert/strict";
import test from "node:test";
import type { InventoryEvent, InventoryProduct, UsageCycle } from "../../types";
import { estimateProduct, median } from "../inventory";

const baseProduct: InventoryProduct = {
  id: "product-1",
  workspace_id: "workspace-1",
  name: "테스트",
  tracking_mode: "cycle",
  unit_label: "ml",
  package_size: 1600,
  capacity_unit: "ml",
  current_quantity: 1600,
  low_stock_threshold: 0,
  alert_days: 30,
  current_consumer_count: 1,
  active_opened_on: null,
  active_consumer_count: null,
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

test("두 명이 76일 쓴 1600ml 제품은 한 명 기준 약 152일로 보정한다", () => {
  const estimate = estimateProduct(baseProduct, [], [cycle()], "2026-07-19");
  assert.equal(estimate.expectedCycleDays, 152);
  assert.equal(estimate.remainingDays, 152);
  assert.ok(estimate.perPersonDailyCapacity);
  assert.ok(Math.abs((estimate.perPersonDailyCapacity || 0) - 10.5263) < 0.001);
});

test("용량형 제품은 현재 남은 용량 비율로 예상 잔여일을 계산한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    unit_label: "g",
    capacity_unit: "g",
    package_size: 200,
    current_quantity: 100
  };
  const estimate = estimateProduct(
    product,
    [],
    [cycle({ duration_days: 20, package_size: 200, capacity_unit: "g", consumer_count: 1 })],
    "2026-07-19"
  );
  assert.equal(estimate.expectedCycleDays, 20);
  assert.equal(estimate.remainingDays, 10);
});

test("개수 방식은 최근 사용 간격의 중앙값으로 남은 기간을 계산한다", () => {
  const product: InventoryProduct = {
    ...baseProduct,
    tracking_mode: "count",
    unit_label: "통",
    package_size: null,
    capacity_unit: null,
    current_quantity: 4
  };
  const events = [
    useEvent("2026-07-01"),
    useEvent("2026-07-09"),
    useEvent("2026-07-17")
  ];
  const estimate = estimateProduct(product, events, [], "2026-07-19");
  assert.equal(estimate.daysPerUnit, 8);
  assert.equal(estimate.remainingDays, 32);
});

test("재고 수량 기준과 예상 소진일 기준 모두 구매 필요를 표시한다", () => {
  const quantityUrgent = estimateProduct(
    { ...baseProduct, current_quantity: 100, low_stock_threshold: 100 },
    [],
    [],
    "2026-07-19"
  );
  assert.equal(quantityUrgent.isUrgent, true);

  const daysUrgent = estimateProduct(
    { ...baseProduct, current_quantity: 1600, low_stock_threshold: 0, alert_days: 160 },
    [],
    [cycle()],
    "2026-07-19"
  );
  assert.equal(daysUrgent.isUrgent, true);
});

test("중앙값은 튀는 사용 기록 하나의 영향을 줄인다", () => {
  assert.equal(median([48, 92, 51, 53]), 52);
});
