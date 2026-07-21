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
  const [draft, setDraft] = useState<InventoryActionDraft>(() =>
    makeDraft(product, action)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const content = useMemo(() => getActionContent(action, product), [action, product]);
  const isCycle = product.tracking_mode === "cycle";
  const isCapacity = product.tracking_mode === "capacity";

  useEffect(() => {
    setDraft(makeDraft(product, action));
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

  const activeSummary =
    product.active_remaining_quantity !== null && product.capacity_unit
      ? ` · 현재 제품 약 ${formatQuantity(product.active_remaining_quantity)}${product.capacity_unit}`
      : "";

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
          {product.active_opened_on ? (
            <span> · {formatDate(product.active_opened_on)} 개봉{activeSummary}</span>
          ) : product.active_remaining_quantity !== null ? (
            <span>{activeSummary} · 개봉일 미입력</span>
          ) : null}
        </div>

        <form className="action-form" onSubmit={(event) => void submit(event)}>
          {action === "intake" || action === "use" ? (
            <label>
              <span className="field-label">
                {action === "intake"
                  ? isCapacity
                    ? "입고 용량"
                    : "입고 수량"
                  : isCapacity
                    ? "사용한 용량"
                    : "사용 수량"}
              </span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  max={action === "use" ? product.current_quantity : undefined}
                  step={isCycle ? "1" : "any"}
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
                {isCycle
                  ? `지금 실제로 보유한 ${product.unit_label} 개수`
                  : isCapacity
                    ? "지금 직접 확인한 실제 남은 용량"
                    : "지금 직접 확인한 실제 재고"}
              </span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  step={isCycle ? "1" : "any"}
                  autoFocus
                  value={draft.targetQuantity}
                  onChange={(event) => update("targetQuantity", event.target.value)}
                />
                <span>{product.unit_label}</span>
              </div>
              {isCycle ? (
                <span className="field-hint">사용 중인 제품도 현재 재고 개수에 포함합니다.</span>
              ) : null}
            </label>
          ) : null}

          {action === "open" ? (
            <>
              <label>
                <span className="field-label">현재 제품 잔량</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    max={product.package_size || undefined}
                    step="any"
                    autoFocus
                    value={draft.amount}
                    onChange={(event) => update("amount", event.target.value)}
                  />
                  <span>{product.capacity_unit || "용량"}</span>
                </div>
                <span className="field-hint">
                  새 제품이면 전체 용량을 그대로 두고, 이미 사용 중이었다면 현재 남은 양을 입력합니다.
                </span>
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
            </>
          ) : null}

          {action === "remainder" ? (
            <label>
              <span className="field-label">지금 확인핔 현재 제품 잔량</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  max={product.package_size || undefined}
                  step="any"
                  autoFocus
                  value={draft.amount}
                  onChange={(event) => update("amount", event.target.value)}
                />
                <span>{product.capacity_unit || "용량"}</span>
              </div>
              <span className="field-hint">전체 재고 개수는 바뀌지 않습니다.</span>
            </label>
          ) : null}

          {action === "finish" ? (
            <div className="finish-note">
              <strong>현재 사용 중인 제품 하나를 다 쓴 것으로 기록합니다.</strong>
              <span>
                현재 재고가 {formatQuantity(product.current_quantity)}{product.unit_label}에서 {formatQuantity(Math.max(0, product.current_quantity - 1))}{product.unit_label}로 줄고, 개봉일부터의 사용 주기가 저장됩니다.
              </span>
            </div>
          ) : null}

          <label>
            <span className="field-label">기록 날짜</span>
            <input
              type="date"
              min={
                action === "finish" || action === "remainder"
                  ? product.active_opened_on || undefined
                  : undefined
              }
              max={todayIso()}
              value={draft.occurredOn}
              onChange={(event) => update("occurredOn", event.target.value)}
            />
            <span className="field-hint">며칠 전에 한 일을 지금 기록해도 됩니다.</span>
          </label>

          {action === "adjustment" || action === "remainder" ? (
            <label>
              <span className="field-label">메모 · 선택</span>
              <textarea
                value={draft.note}
                placeholder={action === "remainder" ? "예: 병 눈금으로 대략 확인" : "예: 냉동실 직접 확인"}
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

function makeDraft(
  product: InventoryProduct,
  action: InventoryAction
): InventoryActionDraft {
  const cycleAmount =
    product.active_remaining_quantity ?? product.package_size ?? 0;

  return {
    amount:
      action === "open" || action === "remainder"
        ? String(cycleAmount)
        : "1",
    targetQuantity: String(product.current_quantity),
    occurredOn: todayIso(),
    consumerCount: String(product.current_consumer_count || 1),
    note: ""
  };
}

function getActionContent(action: InventoryAction, product: InventoryProduct) {
  const isCycle = product.tracking_mode === "cycle";
  const isCapacity = product.tracking_mode === "capacity";

  switch (action) {
    case "intake":
      return {
        title: "입고 기록",
        description: isCycle
          ? `새로 도착한 ${product.unit_label} 개수를 현재 재고에 더합니다.`
          : isCapacity
            ? "새로 도착한 실제 용량을 현재 재고에 더합니다."
            : "새로 도착한 실제 수량을 현재 재고에 더합니다.",
        submitLabel: "입고 기록"
      };
    case "use":
      return {
        title: "사용 기록",
        description: `사용한 ${product.unit_label}만큼 현재 재고에서 뺍니다.`,
        submitLabel: "사용 기록"
      };
    case "open":
      return {
        title: product.active_remaining_quantity !== null ? "개봉 정보 입력" : "새 제품 개봉",
        description: "개봉일과 현재 잔량을 저장해 이 제품 하나의 사용 기간을 측정합니다.",
        submitLabel: "개봉 기록"
      };
    case "finish":
      return {
        title: "다 씀",
        description: "사용 중인 제품 하나의 사용 기간을 완료하고 재고 개수를 1 줄입니다.",
        submitLabel: "소진 기록"
      };
    case "remainder":
      return {
        title: "현재 제품 잔량",
        description: "사용 중인 제품의 남은 g·ml만 바로잡습니다. 전체 통·병 개수는 그대로입니다.",
        submitLabel: "잔량 저장"
      };
    case "adjustment":
    default:
      return {
        title: "재고 정정",
        description: isCycle
          ? "앱 숫자와 실제 보유 통·병·봉 개수가 다를 때 맞춥니다."
          : isCapacity
            ? "앱 숫자와 실제 남은 용량이 다를 때 맞춥니다."
            : "앱 숫자와 실제 재고가 다를 때 맞춥니다.",
        submitLabel: "재고 맞추기"
      };
  }
}
