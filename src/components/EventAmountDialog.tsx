import { useEffect, useMemo, useState } from "react";
import {
  formatDate,
  formatQuantity,
  previewInventoryEventMutation
} from "../lib/inventory";
import { usageTrackingOf } from "../lib/observationAnalysis";
import type { InventoryEvent, InventoryProduct } from "../types";
import { CloseIcon } from "./Icons";

interface EventAmountDialogProps {
  product: InventoryProduct;
  event: InventoryEvent;
  events: InventoryEvent[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function EventAmountDialog({
  product,
  event,
  events,
  busy,
  onClose,
  onSubmit,
  onDelete
}: EventAmountDialogProps) {
  const [amount, setAmount] = useState(() =>
    String(Math.abs(event.quantity_delta))
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const editPreview = useMemo(
    () => previewInventoryEventMutation(
      product,
      events,
      event.id,
      Number(amount)
    ),
    [amount, event.id, events, product]
  );
  const deletePreview = useMemo(
    () => previewInventoryEventMutation(product, events, event.id, null),
    [event.id, events, product]
  );

  useEffect(() => {
    setAmount(String(Math.abs(event.quantity_delta)));
    setFormError(null);
    setDeleteArmed(false);
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
    if (editPreview.error) {
      setFormError(editPreview.error);
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

  async function confirmDelete() {
    if (busy) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      setFormError(deletePreview.error);
      return;
    }
    if (deletePreview.error) {
      setFormError(deletePreview.error);
      return;
    }

    setFormError(null);
    try {
      await onDelete();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "재고 기록을 삭제하지 못했습니다."
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
              {formatDate(event.occurred_on)} 기록 이후의 재고 흐름을 자동으로 다시 계산합니다.
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
            {editPreview.nextQuantity === null
              ? "—"
              : `${formatQuantity(editPreview.nextQuantity)}${product.unit_label}`}
          </strong>
        </div>

        <div className="event-replay-callout">
          <strong>이후 기록 {editPreview.followingEventCount}건 자동 재계산</strong>
          <span>입고·사용·개봉·소진 기록과 현재 재고를 한 번에 맞춥니다.</span>
        </div>

        <form className="action-form" onSubmit={(formEvent) => void submit(formEvent)}>
          <label>
            <span className="field-label">올바른 {actionLabel} 수량</span>
            <div className="input-with-unit">
              <input
                type="number"
                min="1"
                step={usageTrackingOf(product) === "cycle" ? "1" : "any"}
                autoFocus
                value={amount}
                onChange={(inputEvent) => setAmount(inputEvent.target.value)}
              />
              <span>{product.unit_label}</span>
            </div>
            <span className="field-hint">
              과거 기록도 수정할 수 있습니다. 뒤에 입력한 기록은 저장할 때 자동으로 이어서 계산합니다.
            </span>
          </label>

          {deleteArmed && !deletePreview.error ? (
            <div className="event-delete-preview" role="alert">
              <strong>이 기록을 삭제하면 현재 재고가 바뀝니다.</strong>
              <span>
                {formatQuantity(product.current_quantity)}{product.unit_label}
                {" → "}
                {deletePreview.nextQuantity === null
                  ? "—"
                  : `${formatQuantity(deletePreview.nextQuantity)}${product.unit_label}`}
                {` · 이후 ${deletePreview.followingEventCount}건 재계산`}
              </span>
            </div>
          ) : null}

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="dialog-actions event-edit-actions">
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {deleteArmed ? "한 번 더 눌러 삭제" : "기록 삭제"}
            </button>
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
