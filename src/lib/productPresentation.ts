import type { ConsumptionStats, InventoryProduct } from "../types";
import { formatDate, isStockInitialized } from "./inventory";

export function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

export function formatConsumptionAmount(
  stats: ConsumptionStats,
  packageUnit: string
): string {
  if (stats.monthlyAmount === null || !stats.monthlyUnit) {
    return "소비량을 계산할 기록이 더 필요함";
  }

  const base = `약 ${formatDecimal(stats.monthlyAmount)}${stats.monthlyUnit}/월`;
  if (
    stats.monthlyPackageCount !== null &&
    Math.abs(stats.monthlyPackageCount - stats.monthlyAmount) > 0.000001
  ) {
    return `${base} (약 ${formatDecimal(stats.monthlyPackageCount)}${packageUnit}/월)`;
  }
  return base;
}

export function formatConsumptionTotal(
  amount: number | null,
  packageCount: number | null,
  amountUnit: string | null,
  packageUnit: string
): string {
  if (amount === null || !amountUnit) {
    return "소비량을 계산할 기록이 더 필요함";
  }
  const base = `약 ${formatDecimal(amount)}${amountUnit}`;
  if (packageCount !== null && Math.abs(packageCount - amount) > 0.000001) {
    return `${base} (약 ${formatDecimal(packageCount)}${packageUnit})`;
  }
  return base;
}

export function formatActiveMeta(product: InventoryProduct): string {
  if (!isStockInitialized(product)) {
    return "현재 재고를 설정하면 개봉 기록을 시작할 수 있음";
  }

  if (product.active_opened_on) {
    return `${formatDate(product.active_opened_on)}, ${product.active_consumer_count || product.current_consumer_count}명 사용`;
  }
  return product.current_quantity > 0
    ? "아직 개봉한 제품 없음"
    : "사용 중인 제품 없음";
}

export function formatPurchaseForecast(
  date: string,
  daysUntil: number | null
): string {
  if (daysUntil === null) return formatDate(date);
  if (daysUntil < 0) {
    return `${formatDate(date)}, 예상일에서 ${Math.abs(daysUntil)}일 지남`;
  }
  if (daysUntil === 0) return `${formatDate(date)}, 오늘`;
  return `${formatDate(date)}, ${daysUntil}일 후`;
}

export function formatHistoryRange(first: string, last: string): string {
  const compact = (iso: string) => {
    const [year, month] = iso.split("-");
    return `${year}.${month}`;
  };
  return `${compact(first)}–${compact(last)}`;
}
