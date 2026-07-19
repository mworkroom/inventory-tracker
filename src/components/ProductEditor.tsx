import { useEffect, useState } from "react";
import { formatQuantity, todayIso } from "../lib/inventory";
import type { InventoryProduct, ProductDraft, TrackingMode } from "../types";
import { CloseIcon } from "./Icons";

interface ProductEditorProps {
  product: InventoryProduct | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: ProductDraft) => Promise<void>;
}

export function ProductEditor({ product, busy, onClose, onSubmit }: ProductEditorProps) {
  const [draft, setDraft] = useState<ProductDraft>(() => makeDraft(product));
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

  function update<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!draft.name.trim()) {
      setFormError("제품명을 입력해주세요.");
      return;
    }
    if (!draft.unitLabel.trim()) {
      setFormError("재고 단위를 입력해주세요.");
      return;
    }
    if (draft.trackingMode === "cycle") {
      const hasSize = Boolean(draft.packageSize.trim());
      const hasUnit = Boolean(draft.capacityUnit.trim());
      if (hasSize !== hasUnit) {
        setFormError("제품 용량과 용량 단위를 함께 입력해주세요.");
        return;
      }
    }

    try {
      await onSubmit(draft);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "제품을 저장하지 못했습니다.");
    }
  }

  const isEdit = Boolean(product);

  return (
    <div
      className="editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section className="product-editor" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <div className="editor-heading">
          <div>
            <h2 id="product-editor-title">{isEdit ? "제품 설정" : "제품 추가"}</h2>
            <p>{isEdit ? "이름과 구매 기준을 수정합니다." : "현재 실제 재고를 기준으로 처음 등록합니다."}</p>
          </div>
          <button type="button" className="icon-button" aria-label="닫기" disabled={busy} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <form className="product-form" onSubmit={(event) => void submit(event)}>
          <section className="form-section">
            <h3>기본 정보</h3>
            <label>
              <span className="field-label">제품명</span>
              <input value={draft.name} autoFocus={!isEdit} placeholder="예: 코코넛 오일" onChange={(event) => update("name", event.target.value)} />
            </label>

            <div className="form-grid two-columns">
              <label>
                <span className="field-label">재고 단위</span>
                <input value={draft.unitLabel} placeholder="통, 팩, 병" onChange={(event) => update("unitLabel", event.target.value)} />
              </label>
              {!isEdit ? (
                <label>
                  <span className="field-label">현재 실제 재고</span>
                  <input
                    type="number"
                    min="0"
                    step={draft.trackingMode === "cycle" ? "1" : "any"}
                    value={draft.initialQuantity}
                    onChange={(event) => update("initialQuantity", event.target.value)}
                  />
                </label>
              ) : (
                <div className="read-only-field">
                  <span className="field-label">현재 실제 재고</span>
                  <strong>{formatQuantity(product?.current_quantity || 0)}{product?.unit_label}</strong>
                  <small>수량은 카드의 ‘재고 정정’에서 바꿉니다.</small>
                </div>
              )}
            </div>
          </section>

          <section className="form-section">
            <h3>기록 방식</h3>
            <div className="mode-picker">
              <ModeButton
                mode="count"
                selected={draft.trackingMode === "count"}
                disabled={isEdit}
                title="개수로 기록"
                description="소고기 1통처럼 사용할 때 수량을 차감"
                onSelect={() => update("trackingMode", "count")}
              />
              <ModeButton
                mode="cycle"
                selected={draft.trackingMode === "cycle"}
                disabled={isEdit}
                title="개봉·소진으로 기록"
                description="토너나 오일처럼 한 제품을 쓰는 기간을 학습"
                onSelect={() => update("trackingMode", "cycle")}
              />
            </div>
            {isEdit ? <p className="field-hint">기록이 섞이지 않도록 등록 후 방식은 고정됩니다.</p> : null}
          </section>

          <section className="form-section">
            <h3>구매 기준</h3>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">몇 {draft.unitLabel || "개"} 이하일 때 빨간불?</span>
                <input type="number" min="0" step="any" value={draft.lowStockThreshold} onChange={(event) => update("lowStockThreshold", event.target.value)} />
              </label>
              <label>
                <span className="field-label">예상 소진 며칠 전부터?</span>
                <input type="number" min="1" step="1" value={draft.alertDays} onChange={(event) => update("alertDays", event.target.value)} />
              </label>
            </div>
          </section>

          {draft.trackingMode === "cycle" ? (
            <section className="form-section">
              <h3>사용 주기 계산</h3>
              <div className="form-grid two-columns">
                <label>
                  <span className="field-label">제품 용량 · 선택</span>
                  <input type="number" min="0" step="any" value={draft.packageSize} placeholder="1600" onChange={(event) => update("packageSize", event.target.value)} />
                </label>
                <label>
                  <span className="field-label">용량 단위</span>
                  <input value={draft.capacityUnit} placeholder="ml, g" onChange={(event) => update("capacityUnit", event.target.value)} />
                </label>
              </div>
              <label>
                <span className="field-label">현재 사용하는 사람 수</span>
                <input type="number" min="1" step="1" value={draft.currentConsumerCount} onChange={(event) => update("currentConsumerCount", event.target.value)} />
                <span className="field-hint">과거 2명이 쓴 기록을 지금 1명 기준으로 자동 보정합니다.</span>
              </label>
            </section>
          ) : null}

          {!isEdit ? (
            <label className="form-section compact-section">
              <span className="field-label">최초 재고 확인일</span>
              <input type="date" max={todayIso()} value={draft.occurredOn} onChange={(event) => update("occurredOn", event.target.value)} />
            </label>
          ) : null}

          <label className="form-section compact-section">
            <span className="field-label">메모 · 선택</span>
            <textarea value={draft.notes} placeholder="선호 구매처나 제품 설명" onChange={(event) => update("notes", event.target.value)} />
          </label>

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="editor-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>취소</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ModeButton({
  mode,
  selected,
  disabled,
  title,
  description,
  onSelect
}: {
  mode: TrackingMode;
  selected: boolean;
  disabled: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`mode-card${selected ? " selected" : ""}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="mode-symbol" aria-hidden="true">{mode === "count" ? "−1" : "↗"}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

function makeDraft(product: InventoryProduct | null): ProductDraft {
  return {
    name: product?.name || "",
    trackingMode: product?.tracking_mode || "count",
    unitLabel: product?.unit_label || "개",
    initialQuantity: product ? String(product.current_quantity) : "0",
    lowStockThreshold: String(product?.low_stock_threshold ?? 1),
    alertDays: String(product?.alert_days ?? 30),
    packageSize: product?.package_size === null || product?.package_size === undefined ? "" : String(product.package_size),
    capacityUnit: product?.capacity_unit || "",
    currentConsumerCount: String(product?.current_consumer_count ?? 1),
    notes: product?.notes || "",
    occurredOn: todayIso()
  };
}
