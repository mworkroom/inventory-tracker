import type {
  ActiveUsageDraft,
  ConsumptionBaselineDraft,
  InventoryConsumptionBaseline,
  InventoryAction,
  InventoryActionDraft,
  InventoryEvent,
  InventoryProduct,
  InventoryProductSaleSchedule,
  InventoryPurchase,
  InventoryStore,
  ProductDraft,
  PurchaseHistoryDraft,
  PurchaseDraft,
  UsageCycle,
  UsageCycleDraft
} from "../../types";

export type InventoryRefresh = (silent?: boolean) => Promise<void>;

export type RunInventoryMutation = <T>(
  operation: () => Promise<T>
) => Promise<T>;

export interface InventoryState {
  products: InventoryProduct[];
  events: InventoryEvent[];
  cycles: UsageCycle[];
  stores: InventoryStore[];
  purchases: InventoryPurchase[];
  consumptionBaselines: InventoryConsumptionBaseline[];
  saleSchedules: InventoryProductSaleSchedule[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  refresh: InventoryRefresh;
  createProduct: (draft: ProductDraft) => Promise<InventoryProduct>;
  updateProduct: (
    product: InventoryProduct,
    draft: ProductDraft
  ) => Promise<InventoryProduct>;
  upsertConsumptionBaseline: (
    product: InventoryProduct,
    draft: ConsumptionBaselineDraft
  ) => Promise<InventoryConsumptionBaseline>;
  deleteConsumptionBaseline: (product: InventoryProduct) => Promise<void>;
  recordAction: (
    product: InventoryProduct,
    action: InventoryAction,
    draft: InventoryActionDraft
  ) => Promise<InventoryProduct>;
  correctEventAmount: (
    event: InventoryEvent,
    amount: string
  ) => Promise<InventoryProduct>;
  deleteInventoryEvent: (
    event: InventoryEvent
  ) => Promise<InventoryProduct>;
  updateActiveUsage: (
    product: InventoryProduct,
    draft: ActiveUsageDraft
  ) => Promise<InventoryProduct>;
  updateUsageCycle: (
    cycle: UsageCycle,
    draft: UsageCycleDraft
  ) => Promise<UsageCycle>;
  deleteUsageCycle: (cycle: UsageCycle) => Promise<void>;
  createPurchaseHistory: (
    product: InventoryProduct,
    draft: PurchaseHistoryDraft
  ) => Promise<number>;
  updatePurchase: (
    purchase: InventoryPurchase,
    draft: PurchaseDraft
  ) => Promise<InventoryPurchase>;
  deletePurchase: (purchase: InventoryPurchase) => Promise<void>;
  exportBackup: () => Promise<void>;
}
