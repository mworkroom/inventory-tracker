import { useEffect, useState } from "react";
import { todayIso } from "../lib/inventory";
import type { ActiveUsageDraft, InventoryProduct } from "../types";
import { CloseIcon } from "./Icons";

interface ActiveUsageDialogProps {
  product: InventoryProduct;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: ActiveUsageDraft) => Promise<void>;
}

export function ActiveUsageDialog({
  product,
  busy,
  onClose,
  onSubmit
}: ActiveUsageDialogProps) {
  const [draft, setDraft] = useState<ActiveUsageDraft>(() => makeDraft(product));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(makeDraft(product));
    setFormError(null);
  }, [product]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function update<K extends keyof ActiveUsageDraft>(
    key: K,
    value: ActiveUsageDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!draft.openedOn || draft.openedOn > todayIso()) {
      setFormError("개봉일은 오늘 또는 과거 날짜로 입력해주세요.");
      return;
    }
    const consumerCount = Number(draft.consumerCount);
    if (!Number.isInteger(consumerCount) || consumerCount < 1) {
      setFormError("사용 인원은 1명 이상의 정수로 입력해주세요.");
      return;
    }

    try {
      await onSubmit(draft);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "사용 중 정보를 수정하지 못했습니다.");
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="action-dialog active-usage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-usage-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="active-usage-dialog-title">사용 중 정보 수정</h2>
            <p>현재 제품과 연결된 개봉 기록을 함께 바로잡습니다.</p>
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

        <form className="action-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span className="field-label">개봉일</span>
            <input
              type="date"
              max={todayIso()}
              autoFocus
              value={draft.openedOn}
              onChange={(event) => update("openedOn", event.target.value)}
            />
          </label>

          <label>
            <span className="field-label">함께 사용하는 사람 수</span>
            <div className="input-with-unit">
              <input
                type="number"
                min="1"
                step="1"
                value={draft.consumerCount}
                onChange={(event) => update("consumerCount", event.target.value)}
              />
              <span>명</span>
            </div>
          </label>

          <div className="current-stock-banner active-usage-summary">
            재고 개수와 현재 잔량은 바뀌지 않습니다.
          </div>

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="dialog-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
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

function makeDraft(product: InventoryProduct): ActiveUsageDraft {
  return {
    openedOn: product.active_opened_on || todayIso(),
    consumerCount: String(
      product.active_consumer_count || product.current_consumer_count || 1
    )
  };
}
