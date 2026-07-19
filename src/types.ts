export type TrackingMode = "count" | "cycle";
export type InventoryEventType = "intake" | "use" | "open" | "finish" | "adjustment";
export type InventoryFilter = "all" | "urgent" | "learning";

export interface InventoryProduct {
  id: string;
  workspace_id: string;
  name: string;
  tracking_mode: TrackingMode;
  unit_label: string;
  package_size: number | null;
  capacity_unit: string | null;
  current_quantity: number;
  low_stock_threshold: number;
  alert_days: number;
  current_consumer_count: number;
  active_opened_on: string | null;
  active_consumer_count: number | null;
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

export interface ProductDraft {
  name: string;
  trackingMode: TrackingMode;
  unitLabel: string;
  initialQuantity: string;
  lowStockThreshold: string;
  alertDays: string;
  packageSize: string;
  capacityUnit: string;
  currentConsumerCount: string;
  notes: string;
  occurredOn: string;
}

export type InventoryAction = InventoryEventType;

export interface InventoryActionDraft {
  amount: string;
  targetQuantity: string;
  occurredOn: string;
  consumerCount: string;
  note: string;
}

export interface ProductEstimate {
  isUrgent: boolean;
  urgentReason: string | null;
  isLearning: boolean;
  remainingDays: number | null;
  estimatedOutDate: string | null;
  expectedCycleDays: number | null;
  daysPerUnit: number | null;
  perPersonDailyCapacity: number | null;
  cycleSampleCount: number;
  useSampleCount: number;
}
