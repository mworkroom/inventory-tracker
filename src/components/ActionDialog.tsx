import { useEffect, useMemo, useState } from "react";
import {
  formatDate,
  formatQuantity,
  isStockInitialized,
  todayIso
} from "../lib/inventory";
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
  const stockInitialized = isStockInitialized(product);
  const stockCheckTarget = Number(draft.targetQuantity);
  const stockCheckAmount =
    action === "stock_check" &&
    draft.targetQuantity.trim() !== "" &&
    Number.isFinite(stockCheckTarget) &&
    stockCheckTarget >= 0 &&
    stockCheckTarget < product.current_quantity
      ? product.current_quantity - stockCheckTarget
      : null;

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
          현재 재고 <strong>
            {stockInitialized
              ? `${formatQuantity(product.current_quantity)}${product.unit_label}`
              : "미설정"}
          </strong>
          {product.active_opened_on ? (
            <span> · {formatDate(product.active_opened_on)} 개봉</span>
          ) : null}
        </div>

        <form className="action-form" onSubmit={(event) => void submit(event)}>
          {action === "intake" || action === "use" ? (
            <label>
              <span className="field-label">
                {action === "intake" ? "입고 수량" : "사용 수량"}
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

          {action === "adjustment" || action === "stock_check" ? (
            <label>
              <span className="field-label">
                {action === "stock_check"
                  ? "지금 실제로 남아 있는 수량"
                  : stockInitialized
                    ? isCycle
                      ? `정정할 ${product.unit_label} 개수`
                      : "정정할 재고 수량"
                    : isCycle
                      ? `지금 실제로 보유한 ${product.unit_label} 개수`
                      : "지금 직접 확인한 실제 재고"}
              </span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  max={action === "stock_check" ? product.current_quantity : undefined}
                  step={isCycle ? "1" : "any"}
                  autoFocus
                  value={draft.targetQuantity}
                  onChange={(event) => update("targetQuantity", event.target.value)}
                />
                <span>{product.unit_label}</span>
              </div>
              {action === "stock_check" ? (
                <span className="field-hint">
                  앱 재고보다 많다면 입고 또는 재고 정정을 사용해주세요.
                </span>
              ) : isCycle ? (
                <span className="field-hint">사용 중인 제품도 현재 재고 개수에 포함합니다.</span>
              ) : !stockInitialized ? (
                <span className="field-hint">이 수량을 기준으로 이후 입고와 사용을 계산합니다.</span>
              ) : null}
            </label>
          ) : null}

          {action === "stock_check" && stockCheckAmount !== null ? (
            <div className="finish-note">
              <strong>
                사용량 {formatQuantity(stockCheckAmount)}{product.unit_label}으로 기록합니다.
              </strong>
              <span>
                현재 재고 {formatQuantity(product.current_quantity)}{product.unit_label} →{" "}
                {formatQuantity(stockCheckTarget)}{product.unit_label}. 차이는 소비 속도 학습에 반영됩니다.
              </span>
            </div>
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
            <span className="field-label">
              {action === "stock_check" ? "확인 날짜" : "기록 날짜"}
            </span>
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

function makeDraft(
  product: InventoryProduct,
  action: InventoryAction
): InventoryActionDraft {
  return {
    amount: "1",
    targetQuantity: isStockInitialized(product) ? String(product.current_quantity) : "",
    occurredOn: todayIso(),
    consumerCount: String(product.current_consumer_count || 1),
    note: ""
  };
}

function getActionContent(action: InventoryAction, product: InventoryProduct) {
  const isCycle = product.tracking_mode === "cycle";
  const stockInitialized = isStockInitialized(product);

  switch (action) {
    case "intake":
      return {
        title: "입고 기록",
        description: !stockInitialized
          ? `이 입고를 첫 재고 기록으로 삼아 0${product.unit_label}에서 계산을 시작하고, 입고일을 재구매 간격에도 반영합니다.`
          : isCycle
            ? `새로 도착한 ${product.unit_label} 개수를 현재 재고에 더하고, 입고일을 재구매 간격에도 반영합니다.`
            : "새로 도착한 실제 수량을 현재 재고에 더하고, 입고일을 재구매 간격에도 반영합니다.",
        submitLabel: "입고 기록"
      };
    case "use":
      return {
        title: "사용 기록",
        description: `사용한 ${product.unit_label}만큼 현재 재고에서 뺍니다.`,
        submitLabel: "사용 기록"
      };
    case "stock_check":
      return {
        title: "지금 남은 수량 확인",
        description: "실제 잔량을 입력하면 앱 재고와의 차이를 사용량으로 자동 기록합니다.",
        submitLabel: "남은 수량 반영"
      };
    case "open":
      return {
        title: "새 제품 개봉",
        description: "개봉일과 사용 인원을 저장해 이 제품 하나의 사용 기간을 측정합니다.",
        submitLabel: "개봉 기록"
      };
    case "finish":
      return {
        title: "다 씀",
        description: "사용 중인 제품 하나의 사용 기간을 완료하고 재고 개수를 1 줄입니다.",
        submitLabel: "소진 기록"
      };
    case "adjustment":
    default:
      return {
        title: stockInitialized ? "재고 정정" : "현재 재고 설정",
        description: stockInitialized
          ? isCycle
            ? "입력 실수로 잘못된 보유 개수만 바로잡습니다. 사용 기간 학습에는 포함되지 않습니다."
            : "입력 실수로 잘못된 재고 숫자만 바로잡습니다. 소비 속도 학습에는 포함되지 않습니다."
          : "지금 보유한 수량을 기준점으로 저장하고 이후 재고 계산을 시작합니다.",
        submitLabel: stockInitialized ? "재고 맞추기" : "재고 계산 시작"
      };
  }
}
