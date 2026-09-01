export type TrackingMode = "count" | "cycle";
export type UsageTracking = "decrement" | "cycle";
export type InventoryEventType =
  | "intake"
  | "use"
  | "open"
  | "finish"
  | "adjustment";
export type InventoryFilter = "all" | "attention";
export const PRODUCT_CATEGORIES = ["식료품", "화장품", "생활용품", "영양제", "의복", "미분류"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type InventoryViewMode = "store" | "category";

export interface InventoryStore {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InventoryProductStore {
  workspace_id: string;
  product_id: string;
  store_id: string;
  created_by: string | null;
  created_at: string;
}

export interface InventoryProduct {
  id: string;
  workspace_id: string;
  name: string;
  category?: ProductCategory;
  tracking_mode: TrackingMode;
  usage_tracking?: UsageTracking;
  usage_tracking_changed_on?: string | null;
  unit_label: string;
  package_size: number | null;
  capacity_unit: string | null;
  current_quantity: number;
  stock_initialized: boolean;
  low_stock_threshold: number;
  alert_days: number;
  current_consumer_count: number;
  active_opened_on: string | null;
  active_consumer_count: number | null;
  preferred_store_id: string | null;
  store_ids?: string[];
  next_sale_on: string | null;
  purchase_coverage_months: number | null;
  purchase_safety_quantity: number;
  active_months: number[] | null;
  notes: string | null;
  is_archived: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryEvent {
  id: string;
  workspace_id: string;
  product_id: string;
  event_type: InventoryEventType;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  occurred_on: string;
  consumer_count: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface UsageCycle {
  id: string;
  workspace_id: string;
  product_id: string;
  opened_on: string;
  finished_on: string;
  duration_days: number;
  package_size: number | null;
  capacity_unit: string | null;
  consumer_count: number;
  created_by: string | null;
  created_at: string;
}

export interface InventoryPurchase {
  id: string;
  workspace_id: string;
  product_id: string;
  store_id: string;
  purchased_on: string;
  package_count: number;
  package_size: number | null;
  package_unit: string | null;
  total_price: number | null;
  shipping_fee: number | null;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryConsumptionBaseline {
  id: string;
  workspace_id: string;
  product_id: string;
  usage_tracking: UsageTracking;
  started_on: string;
  ended_on: string;
  consumed_quantity: number;
  quantity_unit: string;
  package_size: number | null;
  capacity_unit: string | null;
  consumer_count: number;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryProductSaleSchedule {
  id: string;
  workspace_id: string;
  product_id: string;
  store_id: string | null;
  name: string;
  sale_month: number;
  sale_day: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductDraft {
  name: string;
  category: ProductCategory;
  usageTracking: UsageTracking;
  unitLabel: string;
  lowStockThreshold: string;
  alertDays: string;
  packageSize: string;
  capacityUnit: string;
  storeIds: string[];
  purchaseSafetyQuantity: string;
  saleSchedules: SaleScheduleDraft[];
  notes: string;
}

export interface SaleScheduleDraft {
  id?: string;
  storeId: string;
  name: string;
  saleMonth: string;
  saleDay: string;
}

export interface ConsumptionBaselineDraft {
  startedOn: string;
  endedOn: string;
  consumedQuantity: string;
  consumerCount: string;
  note: string;
}

export type InventoryAction = InventoryEventType | "stock_check";

export interface InventoryActionDraft {
  amount: string;
  targetQuantity: string;
  occurredOn: string;
  consumerCount: string;
  note: string;
}

export interface UsageCycleDraft {
  openedOn: string;
  finishedOn: string;
  consumerCount: string;
}

export interface ActiveUsageDraft {
  openedOn: string;
  consumerCount: string;
}

export interface PurchaseDraft {
  purchasedOn: string;
  storeId: string;
  packageCount: string;
  packageSize: string;
  packageUnit: string;
  totalPrice: string;
  shippingFee: string;
  note: string;
}

export interface PurchaseHistoryDraft {
  storeId: string;
  datesText: string;
  packageCount: string;
  packageSize: string;
  packageUnit: string;
  allowDuplicateDates: boolean;
}

export interface ProductEstimate {
  isUrgent: boolean;
  urgentReason: string | null;
  isLearning: boolean;
  forecastSource: "usage" | "recalled_baseline" | null;
  remainingDays: number | null;
  estimatedOutDate: string | null;
  expectedCycleDays: number | null;
  daysPerUnit: number | null;
  perPersonDailyCapacity: number | null;
  cycleSampleCount: number;
  useSampleCount: number;
}

export interface PurchaseStats {
  purchaseRecordCount: number;
  purchaseDateCount: number;
  totalPackageCount: number;
  intervalSampleCount: number;
  medianIntervalDays: number | null;
  firstPurchasedOn: string | null;
  lastPurchasedOn: string | null;
  lastPurchasePackageCount: number | null;
  latestIntakeOn: string | null;
  latestIntakeQuantity: number | null;
  nextPurchaseDate: string | null;
  daysUntilNextPurchase: number | null;
}

export interface MonthlyConsumptionActual {
  month: string;
  amount: number;
  packageCount: number;
  sampleCount: number;
}

export interface SeasonalityStats {
  status: "observing" | "not_seasonal" | "qualified";
  completeMonthCount: number;
  actualRecordCount: number;
  highestRollingThreeMonthAverage: number | null;
  lowestRollingThreeMonthAverage: number | null;
  monthlyShares: number[] | null;
}

export interface SaleRecommendation {
  scheduleId: string;
  scheduleName: string;
  storeId: string | null;
  opportunityOn: string;
  validThrough: string;
  nextOpportunityOn: string;
  expectedStockOnOpportunity: number | null;
  recommendedQuantity: number | null;
  temporaryPurchaseQuantity: number | null;
}

export interface ConsumptionStats {
  source: "usage" | "recalled_baseline" | null;
  monthlyAmount: number | null;
  monthlyUnit: string | null;
  monthlyPackageCount: number | null;
  annualAmount: number | null;
  annualPackageCount: number | null;
  sampleCount: number;
  observationDays: number | null;
  monthlyActuals: MonthlyConsumptionActual[];
  seasonality: SeasonalityStats;
  saleRecommendation: SaleRecommendation | null;
}
