import { useEffect, useMemo, useState } from "react";
import { formatDate, formatQuantity } from "../lib/inventory";
import type { InventoryEvent, InventoryProduct } from "../types";
import { CloseIcon } from "./Icons";

interface EventAmountDialogProps {
  product: InventoryProduct;
  event: InventoryEvent;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<void>;
}

export function EventAmountDialog({
  product,
  event,
  busy,
  onClose,
  onSubmit
}: EventAmountDialogProps) {
  const [amount, setAmount] = useState(() =>
    String(Math.abs(event.quantity_delta))
  );
  const [formError, setFormError] = useState<string | null>(null);
  const correctedQuantity = useMemo(() => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return event.event_type === "intake"
      ? event.quantity_before + parsed
      : event.quantity_before - parsed;
  }, [amount, event]);

  useEffect(() => {
    setAmount(String(Math.abs(event.quantity_delta)));
    setFormError(null);
  }, [event]);

  useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError("수정 수량은 0보다 크게 입력해주세요.");
      return;
    }
    if (correctedQuantity === null || correctedQuantity < 0) {
      setFormError("사용 수량은 당시 재고보다 많을 수 없습니다.");
      return;
    }

    try {
      await onSubmit(amount);
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "재고 기록을 수정하지 못했습니다."
      );
    }
  }

  const actionLabel = event.event_type === "intake" ? "입고" : "사용";

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.currentTarget === mouseEvent.target && !busy) onClose();
      }}
    >
      <section
        className="action-dialog event-amount-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-amount-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="event-amount-dialog-title">{actionLabel} 기록 수정</h2>
            <p>
              {formatDate(event.occurred_on)} 기록과 현재 재고를 함께 바로잡습니다.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="current-stock-banner">
          현재 재고 <strong>{formatQuantity(product.current_quantity)}{product.unit_label}</strong>
          {" → "}
          <strong>
            {correctedQuantity === null
              ? "—"
              : `${formatQuantity(Math.max(0, correctedQuantity))}${product.unit_label}`}
          </strong>
        </div>

        <form className="action-form" onSubmit={(formEvent) => void submit(formEvent)}>
          <label>
            <span className="field-label">올바른 {actionLabel} 수량</span>
            <div className="input-with-unit">
              <input
                type="number"
                min="0"
                step="any"
                autoFocus
                value={amount}
                onChange={(inputEvent) => setAmount(inputEvent.target.value)}
              />
              <span>{product.unit_label}</span>
            </div>
            <span className="field-hint">
              마지막 재고 기록만 수정할 수 있으며 삭제되지는 않습니다.
            </span>
          </label>

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              취소
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "수정 중…" : "수정 저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
