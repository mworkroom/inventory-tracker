import { WORKSPACE_ID } from "../../config";
import { todayIso, usageCycleDurationDays } from "../../lib/inventory";
import type {
  InventoryProduct,
  ProductDraft,
  PurchaseBulkDraft,
  PurchaseDraft,
  UsageCycleDraft
} from "../../types";
import { PRODUCT_CATEGORIES } from "../../types";

export function buildPurchasePayload(
  product: InventoryProduct,
  draft: PurchaseDraft,
  userId: string
) {
  if (!draft.purchasedOn) throw new Error("구매일을 입력해주세요.");
  return {
    ...buildPurchaseCommonPayload(product, draft, userId),
    purchased_on: draft.purchasedOn,
    total_price: parseOptionalNonnegativeNumber(draft.totalPrice, "총 결제금액"),
    shipping_fee: parseOptionalNonnegativeNumber(draft.shippingFee, "배송비")
  };
}

export function buildPurchaseCommonPayload(
  product: InventoryProduct,
  draft: PurchaseDraft | PurchaseBulkDraft,
  userId: string
) {
  if (!draft.storeId) throw new Error("구매처를 선택해주세요.");
  const packageCount = parseRequiredInteger(draft.packageCount, "구매 수량");
  if (packageCount < 1) throw new Error("구매 수량은 1 이상이어야 합니다.");

  const packageSize = parseOptionalPositiveNumber(draft.packageSize, "제품 용량");
  const packageUnit = draft.packageUnit.trim() || null;
  if ((packageSize === null) !== (packageUnit === null)) {
    throw new Error("제품 용량과 용량 단위를 함께 입력해주세요.");
  }

  return {
    workspace_id: WORKSPACE_ID,
    product_id: product.id,
    store_id: draft.storeId,
    package_count: packageCount,
    package_size: packageSize,
    package_unit: packageUnit,
    note: draft.note.trim() || null,
    created_by: userId,
    updated_by: userId
  };
}

export function parseRequiredNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}을 숫자로 입력해주세요.`);
  return parsed;
}

export function parseOptionalPositiveNumber(
  value: string,
  label: string
): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}은 0보다 큰 숫자로 입력해주세요.`);
  }
  return parsed;
}

function parseOptionalNonnegativeNumber(
  value: string,
  label: string
): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}은 0 이상의 숫자로 입력해주세요.`);
  }
  return parsed;
}

export function parseRequiredInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label}을 정수로 입력해주세요.`);
  return parsed;
}

export function parseLowStockThreshold(draft: ProductDraft): number {
  const threshold =
    draft.trackingMode === "cycle"
      ? parseRequiredInteger(draft.lowStockThreshold, "재고 알림 수량")
      : parseRequiredNumber(draft.lowStockThreshold, "재고 알림 수량");
  if (threshold < 0) throw new Error("재고 알림 수량은 0 이상이어야 합니다.");
  return threshold;
}

export function normalizeCategory(
  category: string
): (typeof PRODUCT_CATEGORIES)[number] {
  return PRODUCT_CATEGORIES.includes(
    category as (typeof PRODUCT_CATEGORIES)[number]
  )
    ? (category as (typeof PRODUCT_CATEGORIES)[number])
    : "미분류";
}

export function validateCycleProductDraft(draft: ProductDraft): void {
  if (draft.trackingMode !== "cycle") return;
  if (!draft.packageSize.trim()) {
    throw new Error("제품 1개의 전체 용량을 입력해주세요.");
  }
  if (!draft.capacityUnit.trim()) {
    throw new Error("제품 용량 단위를 입력해주세요.");
  }
  if (
    draft.unitLabel.trim().toLowerCase() ===
    draft.capacityUnit.trim().toLowerCase()
  ) {
    throw new Error(
      "재고 단위에는 통·병·봉처럼 포장 개수를 나타내는 말을 입력해주세요."
    );
  }
  const consumerCount = parseRequiredInteger(
    draft.currentConsumerCount,
    "사용 인원"
  );
  if (consumerCount < 1) throw new Error("사용 인원은 1명 이상이어야 합니다.");
}

export function validateUsageCycleDraft(draft: UsageCycleDraft): {
  durationDays: number;
  consumerCount: number;
} {
  if (!draft.openedOn || !draft.finishedOn) {
    throw new Error("개봉일과 다 쓴 날을 모두 입력해주세요.");
  }
  const durationDays = usageCycleDurationDays(
    draft.openedOn,
    draft.finishedOn
  );
  if (durationDays < 1) {
    throw new Error("다 쓴 날은 개봉일보다 빠를 수 없습니다.");
  }
  if (draft.finishedOn > todayIso()) {
    throw new Error("미래 날짜는 과거 사용 기록으로 저장할 수 없습니다.");
  }
  const consumerCount = parseRequiredInteger(draft.consumerCount, "사용 인원");
  if (consumerCount < 1) throw new Error("사용 인원은 1명 이상이어야 합니다.");
  return { durationDays, consumerCount };
}
