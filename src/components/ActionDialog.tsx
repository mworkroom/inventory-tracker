import { useEffect, useMemo, useState } from "react";
import { formatDate, formatQuantity, todayIso } from "../lib/inventory";
import type {
  InventoryAction,
  InventoryActionDraft,
  InventoryProduct
} from "../types";
import { CloseIcon } from "./Icons";

interface ActionDialogProps {
  product: InventoryProduct;
  action: InventoryAction;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: InventoryActionDraft) => Promise<void>;
}

export function ActionDialog({
  product,
  action,
  busy,
  onClose,
  onSubmit
}: ActionDialogProps) {
  const [draft, setDraft] = useState<InventoryActionDraft>(() => makeDraft(product));
  const [formError, setFormError] = useState<string | null>(null);
  const content = useMemo(() => getActionContent(action, product), [action, product]);
  const isCapacity = product.tracking_mode === "cycle";

  useEffect(() => {
    setDraft(makeDraft(product));
    setFormError(null);
  }, [action, product]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function update<K extends keyof InventoryActionDraft>(
    key: K,
    value: InventoryActionDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      await onSubmit(draft);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "기록을 저장하지 못했습니다.");
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
        className="action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="action-dialog-title">{content.title}</h2>
            <p>{content.description}</p>
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
          {product.active_opened_on ? <span> · {formatDate(product.active_opened_on)} 개봉</span> : null}
        </div>

        <form className="action-form" onSubmit={(event) => void submit(event)}>
          {action === "intake" || action === "use" ? (
            <label>
              <span className="field-label">
                {action === "intake"
                  ? isCapacity
                    ? "입고 용량"
                    : "입고 수량"
                  : "사용 수량"}
              </span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  max={action === "use" ? product.current_quantity : undefined}
                  step="any"
                  autoFocus
                  value={draft.amount}
                  onChange={(event) => update("amount", event.target.value)}
                />
                <span>{product.unit_label}</span>
              </div>
            </label>
          ) : null}

          {action === "adjustment" ? (
            <label>
              <span className="field-label">
                {isCapacity ? "지금 직접 확인한 남은 총 용량" : "지금 직접 확인한 실제 재고"}
              </span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  step="any"
                  autoFocus
                  value={draft.targetQuantity}
                  onChange={(event) => update("targetQuantity", event.target.value)}
                />
                <span>{product.unit_label}</span>
              </div>
            </label>
          ) : null}

          {action === "open" ? (
            <label>
              <span className="field-label">함께 사용하는 사람 수</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="1"
                  step="1"
                  autoFocus
                  value={draft.consumerCount}
                  onChange={(event) => update("consumerCount", event.target.value)}
                />
                <span>명</span>
              </div>
              <span className="field-hint">이번 제품의 사용 기간을 인원수에 맞춰 기록합니다.</span>
            </label>
          ) : null}

          {action === "finish" ? (
            <div className="finish-note">
              <strong>사용 중인 제품 하나를 다 쓴 것으로 기록합니다.</strong>
              <span>
                현재 재고에서 제품 1개분
                {product.package_size
                  ? `(${formatQuantity(product.package_size)}${product.unit_label})`
                  : ""}이 빠지고, 개봉일부터 오늘까지의 사용 주기가 저장됩니다.
              </span>
            </div>
          ) : null}

          <label>
            <span className="field-label">기록 날짜</span>
            <input
              type="date"
              min={action === "finish" ? product.active_opened_on || undefined : undefined}
              max={todayIso()}
              value={draft.occurredOn}
              onChange={(event) => update("occurredOn", event.target.value)}
            />
            <span className="field-hint">며칠 전에 한 일을 지금 기록해도 됩니다.</span>
          </label>

          {action === "adjustment" ? (
            <label>
              <span className="field-label">메모 · 선택</span>
              <textarea
                value={draft.note}
                placeholder="예: 냉동실 직접 확인"
                onChange={(event) => update("note", event.target.value)}
              />
            </label>
          ) : null}

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="dialog-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
              취소
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "기록 중…" : content.submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function makeDraft(product: InventoryProduct): InventoryActionDraft {
  return {
    amount:
      product.tracking_mode === "cycle" && product.package_size
        ? String(product.package_size)
        : "1",
    targetQuantity: String(product.current_quantity),
    occurredOn: todayIso(),
    consumerCount: String(product.current_consumer_count || 1),
    note: ""
  };
}

function getActionContent(action: InventoryAction, product: InventoryProduct) {
  const isCapacity = product.tracking_mode === "cycle";

  switch (action) {
    case "intake":
      return {
        title: "입고 기록",
        description: isCapacity
          ? "새로 도착해서 실제 보관 중인 용량을 더합니다."
          : "새로 도착해서 실제 보관 중인 수량을 더합니다.",
        submitLabel: "입고 기록"
      };
    case "use":
      return {
        title: "사용 기록",
        description: `꺼내 쓴 ${product.unit_label} 수만큼 현재 재고에서 뺍니다.`,
        submitLabel: "사용 기록"
      };
    case "open":
      return {
        title: "새 제품 개봉",
        description: "오늘부터 이 제품 하나의 실제 사용 기간을 측정합니다.",
        submitLabel: "개봉 기록"
      };
    case "finish":
      return {
        title: "다 씀",
        description: "완료된 제품 하나의 사용 기간을 학습 기록으로 남깁니다.",
        submitLabel: "소진 기록"
      };
    case "adjustment":
    default:
      return {
        title: "재고 정정",
        description: isCapacity
          ? "앱 숫자와 실제 남은 용량이 다를 때 현재 양을 맞춥니다."
          : "앱 숫자와 실제 재고가 다를 때 현재 수량을 맞춥니다.",
        submitLabel: "재고 맞추기"
      };
  }
}
