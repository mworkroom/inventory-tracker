import { WORKSPACE_ID } from "../../config";
import { todayIso, usageCycleDurationDays } from "../../lib/inventory";
import type {
  ConsumptionBaselineDraft,
  InventoryProduct,
  ProductDraft,
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
  draft: Pick<
    PurchaseDraft,
    "storeId" | "packageCount" | "packageSize" | "packageUnit"
  > & { note?: string },
  userId: string
) {
  if (!draft.storeId) throw new Error("쇼핑몰을 선택해주세요.");
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
    note: draft.note?.trim() || null,
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
    draft.usageTracking === "cycle"
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

export function validateProductDraft(draft: ProductDraft): void {
  const packageSize = parseOptionalPositiveNumber(draft.packageSize, "제품 용량");
  const capacityUnit = draft.capacityUnit.trim();
  if ((packageSize === null) !== (capacityUnit === "")) {
    throw new Error("제품 용량과 용량 단위를 함께 입력해주세요.");
  }
  if (
    capacityUnit &&
    draft.unitLabel.trim().toLowerCase() === capacityUnit.toLowerCase()
  ) {
    throw new Error(
      "재고 단위에는 통·병·봉처럼 실제로 세는 단위를 입력해주세요."
    );
  }

  const selectedStores = new Set(draft.storeIds);
  const scheduleKeys = new Set<string>();
  draft.saleSchedules.forEach((schedule, index) => {
    const label = `정기 세일 ${index + 1}`;
    if (!schedule.storeId || !selectedStores.has(schedule.storeId)) {
      throw new Error(`${label}의 쇼핑몰을 제품 구매처에서 선택해주세요.`);
    }
    if (!schedule.name.trim()) {
      throw new Error(`${label}의 행사명을 입력해주세요.`);
    }
    const month = parseRequiredInteger(schedule.saleMonth, `${label} 월`);
    const day = parseRequiredInteger(schedule.saleDay, `${label} 일`);
    const maxDay = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;
    if (month < 1 || month > 12 || day < 1 || day > maxDay) {
      throw new Error(`${label}의 날짜를 확인해주세요.`);
    }
    const key = `${schedule.storeId}:${month}:${day}:${schedule.name.trim().toLowerCase()}`;
    if (scheduleKeys.has(key)) {
      throw new Error("같은 정기 세일 일정이 중복되어 있습니다.");
    }
    scheduleKeys.add(key);
  });
}

export function validateConsumptionBaselineDraft(
  draft: ConsumptionBaselineDraft,
  usageTracking: ProductDraft["usageTracking"]
): { consumedQuantity: number; consumerCount: number } {
  if (!draft.startedOn || !draft.endedOn) {
    throw new Error("대략적인 시작일과 종료일을 모두 입력해주세요.");
  }
  if (draft.endedOn < draft.startedOn) {
    throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
  }
  if (draft.startedOn > todayIso() || draft.endedOn > todayIso()) {
    throw new Error("회상 소비 기준에는 오늘 또는 과거 날짜만 입력해주세요.");
  }
  const consumerCount = parseRequiredInteger(draft.consumerCount, "사용 인원");
  if (consumerCount < 1) throw new Error("사용 인원은 1명 이상이어야 합니다.");
  const consumedQuantity = usageTracking === "cycle"
    ? 1
    : parseRequiredNumber(draft.consumedQuantity, "총사용량");
  if (consumedQuantity <= 0) throw new Error("총사용량은 0보다 커야 합니다.");
  return { consumedQuantity, consumerCount };
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
