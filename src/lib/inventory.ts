import type {
  InventoryEvent,
  InventoryProduct,
  InventoryPurchase,
  PurchaseStats
} from "../types";

const DAY_MS = 86_400_000;

export function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isStockInitialized(product: InventoryProduct): boolean {
  return product.stock_initialized !== false;
}

export function calculateStockCheckUsage(
  currentQuantity: number,
  targetQuantity: string
): number {
  if (!targetQuantity.trim()) {
    throw new Error("실제 남은 수량을 입력해주세요.");
  }
  const actualQuantity = Number(targetQuantity);
  if (!Number.isFinite(actualQuantity)) {
    throw new Error("실제 남은 수량을 숫자로 입력해주세요.");
  }
  if (actualQuantity < 0) {
    throw new Error("실제 남은 수량은 0 이상이어야 합니다.");
  }
  if (actualQuantity > currentQuantity) {
    throw new Error("앱 재고보다 많다면 입고 또는 재고 정정을 사용해주세요.");
  }
  if (actualQuantity === currentQuantity) {
    throw new Error("입력한 수량이 현재 앱 재고와 같습니다.");
  }
  return currentQuantity - actualQuantity;
}

export interface InventoryEventMutationPreview {
  nextQuantity: number | null;
  followingEventCount: number;
  error: string | null;
}

export function previewInventoryEventMutation(
  product: InventoryProduct,
  events: InventoryEvent[],
  targetEventId: string,
  amount: number | null
): InventoryEventMutationPreview {
  const orderedEvents = events
    .filter((event) => event.product_id === product.id)
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );
  const targetIndex = orderedEvents.findIndex(
    (event) => event.id === targetEventId
  );
  if (targetIndex < 0) {
    return {
      nextQuantity: null,
      followingEventCount: 0,
      error: "수정할 재고 기록을 찾을 수 없습니다."
    };
  }

  const target = orderedEvents[targetIndex];
  if (target.event_type !== "intake" && target.event_type !== "use") {
    return {
      nextQuantity: null,
      followingEventCount: orderedEvents.length - targetIndex - 1,
      error: "입고 또는 사용 기록만 수정하거나 삭제할 수 있습니다."
    };
  }
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return {
      nextQuantity: null,
      followingEventCount: orderedEvents.length - targetIndex - 1,
      error: "수정 수량은 0보다 커야 합니다."
    };
  }
  const isCycle = product.usage_tracking === "cycle" ||
    (!product.usage_tracking && product.tracking_mode === "cycle");
  if (amount !== null && isCycle && !Number.isInteger(amount)) {
    return {
      nextQuantity: null,
      followingEventCount: orderedEvents.length - targetIndex - 1,
      error: "개봉·소진 제품의 입고 수량은 정수로 입력해주세요."
    };
  }

  let runningQuantity = 0;
  for (const event of orderedEvents) {
    if (event.id === targetEventId && amount === null) continue;

    let nextQuantity: number;
    switch (event.event_type) {
      case "intake": {
        const eventAmount = event.id === targetEventId
          ? amount!
          : Math.abs(event.quantity_delta);
        nextQuantity = runningQuantity + eventAmount;
        break;
      }
      case "use": {
        const eventAmount = event.id === targetEventId
          ? amount!
          : Math.abs(event.quantity_delta);
        nextQuantity = runningQuantity - eventAmount;
        break;
      }
      case "open":
        if (runningQuantity <= 0) {
          return {
            nextQuantity: null,
            followingEventCount: orderedEvents.length - targetIndex - 1,
            error: `${formatDate(event.occurred_on)} 개봉 기록 시점에 재고가 0이 됩니다.`
          };
        }
        nextQuantity = runningQuantity;
        break;
      case "finish":
        nextQuantity = runningQuantity - 1;
        break;
      case "adjustment":
        nextQuantity = event.quantity_after;
        break;
    }

    if (nextQuantity < 0) {
      return {
        nextQuantity: null,
        followingEventCount: orderedEvents.length - targetIndex - 1,
        error: `${formatDate(event.occurred_on)} 기록을 반영하면 재고가 음수가 됩니다.`
      };
    }
    runningQuantity = nextQuantity;
  }

  return {
    nextQuantity: runningQuantity,
    followingEventCount: orderedEvents.length - targetIndex - 1,
    error: null
  };
}

export function calculatePurchaseStats(
  productId: string,
  purchases: InventoryPurchase[],
  events: InventoryEvent[] = [],
  today = todayIso()
): PurchaseStats {
  const productPurchases = purchases.filter(
    (purchase) => purchase.product_id === productId
  );
  const productIntakes = events.filter(
    (event) =>
      event.product_id === productId &&
      event.event_type === "intake"
  );
  const uniqueDates = [
    ...new Set(productPurchases.map((purchase) => purchase.purchased_on))
  ].sort(compareIsoDate);
  const intervals: number[] = [];

  for (let index = 1; index < uniqueDates.length; index += 1) {
    const interval = daysBetween(uniqueDates[index - 1], uniqueDates[index]);
    if (interval > 0) intervals.push(interval);
  }

  const recentIntervals = intervals.slice(-7);
  const medianIntervalDays = median(recentIntervals);
  const lastPurchasedOn = uniqueDates.at(-1) ?? null;
  const latestPurchase = lastPurchasedOn
    ? productPurchases
        .filter((purchase) => purchase.purchased_on === lastPurchasedOn)
        .reduce<number>((sum, purchase) => sum + purchase.package_count, 0)
    : null;
  const latestIntake = [...productIntakes].sort((a, b) => {
    const dateComparison = compareIsoDate(b.occurred_on, a.occurred_on);
    return dateComparison || b.created_at.localeCompare(a.created_at);
  })[0] ?? null;
  const nextPurchaseDate =
    lastPurchasedOn && medianIntervalDays !== null
      ? addDays(lastPurchasedOn, Math.round(medianIntervalDays))
      : null;

  return {
    purchaseRecordCount: productPurchases.length,
    purchaseDateCount: uniqueDates.length,
    totalPackageCount: productPurchases.reduce(
      (sum, purchase) => sum + purchase.package_count,
      0
    ),
    intervalSampleCount: recentIntervals.length,
    medianIntervalDays,
    firstPurchasedOn: uniqueDates[0] ?? null,
    lastPurchasedOn,
    lastPurchasePackageCount: latestPurchase,
    latestIntakeOn: latestIntake?.occurred_on ?? null,
    latestIntakeQuantity: latestIntake
      ? Math.abs(latestIntake.quantity_delta)
      : null,
    nextPurchaseDate,
    daysUntilNextPurchase:
      nextPurchaseDate === null ? null : daysBetween(today, nextPurchaseDate)
  };
}

export function parsePurchaseDates(
  input: string,
  maxDate = todayIso()
): string[] {
  const lines = input
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("구매 날짜를 한 줄에 하나씩 입력해주세요.");
  }

  const invalidLines: string[] = [];
  const normalizedDates: string[] = [];

  for (const line of lines) {
    const normalized = normalizePurchaseDate(line);
    if (!normalized || normalized > maxDate) {
      invalidLines.push(line);
      continue;
    }
    normalizedDates.push(normalized);
  }

  if (invalidLines.length > 0) {
    const preview = invalidLines.slice(0, 3).join(", ");
    throw new Error(`날짜 형식을 확인해주세요: ${preview}`);
  }

  return [...new Set(normalizedDates)].sort(compareIsoDate);
}

export function parseDateInput(value: string): string | null {
  const trimmed = value.trim();
  const usMatch = trimmed.match(
    /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/
  );

  if (usMatch) {
    return toIsoDate(
      Number(usMatch[3]),
      Number(usMatch[1]),
      Number(usMatch[2])
    );
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  const koreanMatch = trimmed.match(
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*\.?$/
  );
  const separatedMatch = trimmed.match(
    /^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*\.?$/
  );
  const match = compactMatch || koreanMatch || separatedMatch;
  if (!match) return null;

  return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function normalizePurchaseDate(value: string): string | null {
  return parseDateInput(value);
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function median(values: number[]): number | null {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const middle = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) return valid[middle];
  return (valid[middle - 1] + valid[middle]) / 2;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((isoToUtcMs(toIso) - isoToUtcMs(fromIso)) / DAY_MS);
}

export function usageCycleDurationDays(openedOn: string, finishedOn: string): number {
  return daysBetween(openedOn, finishedOn) + 1;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(isoToUtcMs(iso) + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDateInput(iso) || "—";
}

export function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!toIsoDate(year, month, day)) return "";
  return `${month}/${day}/${year}`;
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 3
  }).format(value);
}

export function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0
  }).format(value)}원`;
}

export function formatApproxDays(value: number | null): string {
  if (value === null) return "학습 중";
  const days = Math.max(0, Math.round(value));
  if (days < 60) return `약 ${days}일`;
  const months = days / 30.4375;
  if (months < 12) {
    return `약 ${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 1
    }).format(months)}개월`;
  }
  const years = months / 12;
  return `약 ${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1
  }).format(years)}년`;
}

export function eventLabel(
  event: InventoryEvent,
  unitLabel: string
): string {
  const amount = formatQuantity(Math.abs(event.quantity_delta));
  switch (event.event_type) {
    case "intake":
      return `${amount}${unitLabel} 입고`;
    case "use":
      return `${amount}${unitLabel} 사용`;
    case "open":
      return `새 제품 개봉${event.consumer_count ? ` · ${event.consumer_count}명` : ""}`;
    case "finish":
      return `다 씀${event.consumer_count ? ` · ${event.consumer_count}명` : ""}`;
    case "adjustment":
      return `재고 ${formatQuantity(event.quantity_after)}${unitLabel}으로 정정`;
  }
}

export function actionPastTense(action: string): string {
  switch (action) {
    case "intake":
      return "입고를";
    case "use":
      return "사용을";
    case "open":
      return "개봉을";
    case "finish":
      return "소진을";
    case "adjustment":
      return "재고 정정을";
    case "stock_check":
      return "남은 수량을 확인해";
    default:
      return "기록을";
  }
}

function isoToUtcMs(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}
