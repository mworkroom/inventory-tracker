import type { InventoryFilter } from "../types";

interface FilterTabsProps {
  value: InventoryFilter;
  counts: Record<InventoryFilter, number>;
  onChange: (value: InventoryFilter) => void;
}

const FILTERS: Array<{ value: InventoryFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "urgent", label: "구매 필요" },
  { value: "learning", label: "학습 중" }
];

export function FilterTabs({ value, counts, onChange }: FilterTabsProps) {
  return (
    <div className="filter-tabs" role="tablist" aria-label="재고 상태 필터">
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          role="tab"
          aria-selected={value === filter.value}
          className={value === filter.value ? "active" : ""}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
          <small>{counts[filter.value]}</small>
        </button>
      ))}
    </div>
  );
}
