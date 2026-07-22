import type { InventoryViewMode } from "../types";

interface ViewModeToggleProps {
  value: InventoryViewMode;
  onChange: (value: InventoryViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="view-mode-toggle" role="group" aria-label="목록 보기 방식">
      <button
        type="button"
        className={value === "store" ? "active" : ""}
        aria-pressed={value === "store"}
        onClick={() => onChange("store")}
      >
        구매처
      </button>
      <button
        type="button"
        className={value === "category" ? "active" : ""}
        aria-pressed={value === "category"}
        onClick={() => onChange("category")}
      >
        카테고리
      </button>
    </div>
  );
}
