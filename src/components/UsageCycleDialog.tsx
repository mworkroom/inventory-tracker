import { useEffect, useMemo, useState } from "react";
import { todayIso, usageCycleDurationDays } from "../lib/inventory";
import type { InventoryProduct, UsageCycle, UsageCycleDraft } from "../types";
import { DateInput } from "./DateInput";
import { CloseIcon } from "./Icons";

interface UsageCycleDialogProps {
  product: InventoryProduct;
  cycle: UsageCycle;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: UsageCycleDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function UsageCycleDialog({
  product,
  cycle,
  busy,
  onClose,
  onSubmit,
  onDelete
}: UsageCycleDialogProps) {
  const [draft, setDraft] = useState<UsageCycleDraft>(() => makeDraft(cycle));
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const durationDays = useMemo(() => {
    if (!draft.openedOn || !draft.finishedOn) return null;
    const days = usageCycleDurationDays(draft.openedOn, draft.finishedOn);
    return days > 0 ? days : null;
  }, [draft.finishedOn, draft.openedOn]);

  useEffect(() => {
    setDraft(makeDraft(cycle));
    setFormError(null);
    setDeleteArmed(false);
  }, [cycle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function update<K extends keyof UsageCycleDraft>(
    key: K,
    value: UsageCycleDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!draft.openedOn || !draft.finishedOn) {
      setFormError("개봉일과 다 쓴 날을 모두 입력해주세요.");
      return;
    }
    if (usageCycleDurationDays(draft.openedOn, draft.finishedOn) < 1) {
      setFormError("다 쓴 날은 개봉일보다 빠를 수 없습니다.");
      return;
    }
    if (draft.finishedOn > todayIso()) {
      setFormError("미래 날짜는 과거 사용 기록으로 저장할 수 없습니다.");
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
      setFormError(caught instanceof Error ? caught.message : "사용 주기를 저장하지 못했습니다.");
    }
  }

  async function confirmDelete() {
    if (busy) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }

    setFormError(null);
    try {
      await onDelete();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "사용 주기를 삭제하지 못했습니다.");
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
        className="action-dialog usage-cycle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-cycle-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="usage-cycle-dialog-title">사용 주기 수정</h2>
            <p>자동 기록된 기간이나 사용 인원이 잘못된 경우에만 바로잡습니다.</p>
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

        <form className="action-form" onSubmit={submit}>
          <div className="form-grid two-columns">
            <label>
              <span className="field-label">개봉일</span>
              <DateInput
                max={draft.finishedOn || todayIso()}
                value={draft.openedOn}
                onChange={(value) => update("openedOn", value)}
              />
              <span className="field-hint">달력에서 선택하거나 직접 입력할 수 있습니다.</span>
            </label>
            <label>
              <span className="field-label">다 쓴 날</span>
              <DateInput
                min={draft.openedOn || undefined}
                max={todayIso()}
                value={draft.finishedOn}
                onChange={(value) => update("finishedOn", value)}
              />
              <span className="field-hint">달력에서 선택하거나 직접 입력할 수 있습니다.</span>
            </label>
          </div>

          <label>
            <span className="field-label">그때 함께 사용한 사람 수</span>
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
            <span className="field-hint">기본값은 1명이며, 실제 함께 사용한 인원으로 바꿀 수 있습니다.</span>
          </label>

          <div className="current-stock-banner usage-cycle-summary">
            사용 기간 <strong>{durationDays === null ? "날짜를 입력해주세요" : `${durationDays}일`}</strong>
          </div>

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="dialog-actions purchase-edit-actions">
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {deleteArmed ? "한 번 더 눌러 삭제" : "삭제"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
              취소
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "저장 중…" : "수정 저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function makeDraft(cycle: UsageCycle): UsageCycleDraft {
  return {
    openedOn: cycle.opened_on,
    finishedOn: cycle.finished_on,
    consumerCount: String(cycle.consumer_count)
  };
}
