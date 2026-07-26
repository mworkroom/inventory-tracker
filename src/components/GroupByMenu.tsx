import { useRef } from "react";
import type { InventoryViewMode } from "../types";
import { ChevronIcon } from "./Icons";

interface GroupByMenuProps {
  value: InventoryViewMode;
  onChange: (value: InventoryViewMode) => void;
}

const GROUPING_OPTIONS: Array<{
  value: InventoryViewMode;
  label: string;
}> = [
  { value: "category", label: "카테고리" },
  { value: "store", label: "쇼핑몰" }
];

export function GroupByMenu({ value, onChange }: GroupByMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const currentLabel =
    GROUPING_OPTIONS.find((option) => option.value === value)?.label ||
    "카테고리";

  function select(value: InventoryViewMode) {
    onChange(value);
    menuRef.current?.removeAttribute("open");
  }

  return (
    <details ref={menuRef} className="group-by-menu">
      <summary>
        <span>묶기:</span>
        <strong>{currentLabel}</strong>
        <ChevronIcon />
      </summary>
      <div className="group-by-menu-panel" role="menu" aria-label="목록 묶기 방식">
        {GROUPING_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={value === option.value}
            className={value === option.value ? "active" : ""}
            onClick={() => select(option.value)}
          >
            <span>{option.label}</span>
            {value === option.value ? <span aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>
    </details>
  );
}
