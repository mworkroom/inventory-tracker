import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  UsageCycle
} from "../types";

export function canDeleteUnusedProduct(
  product: InventoryProduct,
  events: InventoryEvent[],
  cycles: UsageCycle[],
  purchases: InventoryPurchase[]
): boolean {
  if (product.active_opened_on) return false;

  const productEvents = events.filter(
    (event) => event.product_id === product.id
  );
  const hasNoRealInventoryHistory =
    productEvents.length === 0 ||
    (productEvents.length === 1 &&
      productEvents[0].event_type === "adjustment" &&
      productEvents[0].quantity_before === 0 &&
      ["최초 재고 등록", "재고 기준 설정"].includes(
        productEvents[0].note || ""
      ));

  return (
    hasNoRealInventoryHistory &&
    !cycles.some((cycle) => cycle.product_id === product.id) &&
    !purchases.some((purchase) => purchase.product_id === product.id)
  );
}
