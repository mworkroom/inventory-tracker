import { useEffect, useMemo, useState } from "react";
import { todayIso, usageCycleDurationDays } from "../lib/inventory";
import type { InventoryProduct, UsageCycle, UsageCycleDraft } from "../types";
import { CloseIcon } from "./Icons";

interface UsageCycleDialogProps {
  product: InventoryProduct;
  cycle: UsageCycle | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: UsageCycleDraft) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
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
    if (!onDelete || busy) return;
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

  const isEdit = Boolean(cycle);

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
            <h2 id="usage-cycle-dialog-title">
              {isEdit ? "사용 주기 수정" : "과거 사용 주기 추가"}
            </h2>
            <p>
              {isEdit
                ? "잘못 입력한 기간과 사용 인원을 바로잡습니다."
                : "이미 다 쓴 제품의 사용 기간을 재고 변화 없이 학습 자료로 저장합니다."}
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

        <form className="action-form" onSubmit={submit}>
          <div className="form-grid two-columns">
            <label>
              <span className="field-label">개봉일</span>
              <input
                type="date"
                max={draft.finishedOn || todayIso()}
                value={draft.openedOn}
                onChange={(event) => update("openedOn", event.target.value)}
              />
            </label>
            <label>
              <span className="field-label">다 쓴 날</span>
              <input
                type="date"
                min={draft.openedOn || undefined}
                max={todayIso()}
                value={draft.finishedOn}
                onChange={(event) => update("finishedOn", event.target.value)}
              />
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

          <div className={`dialog-actions${isEdit ? " purchase-edit-actions" : ""}`}>
            {isEdit ? (
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {deleteArmed ? "한 번 더 눌러 삭제" : "삭제"}
              </button>
            ) : null}
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
              취소
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "저장 중…" : isEdit ? "수정 저장" : "과거 사용 주기 저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function makeDraft(cycle: UsageCycle | null): UsageCycleDraft {
  return {
    openedOn: cycle?.opened_on || "",
    finishedOn: cycle?.finished_on || todayIso(),
    consumerCount: String(cycle?.consumer_count || 1)
  };
}
