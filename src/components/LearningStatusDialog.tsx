import { useEffect, useMemo, useState } from "react";
import type { InventoryViewModel } from "../hooks/useInventoryViewModel";
import { formatDate } from "../lib/inventory";
import { usageTrackingOf } from "../lib/observationAnalysis";
import type {
  ConsumptionBaselineDraft,
  InventoryConsumptionBaseline,
  InventoryProduct
} from "../types";
import { CloseIcon } from "./Icons";
import { DateInput } from "./DateInput";

interface LearningStatusDialogProps {
  products: InventoryProduct[];
  baselines: InventoryConsumptionBaseline[];
  view: InventoryViewModel;
  busy: boolean;
  onSaveBaseline: (
    product: InventoryProduct,
    draft: ConsumptionBaselineDraft
  ) => Promise<void>;
  onDeleteBaseline: (product: InventoryProduct) => Promise<void>;
  onClose: () => void;
}

export function LearningStatusDialog({
  products,
  baselines,
  view,
  busy,
  onSaveBaseline,
  onDeleteBaseline,
  onClose
}: LearningStatusDialogProps) {
  const [editingProduct, setEditingProduct] = useState<InventoryProduct | null>(null);
  const [draft, setDraft] = useState<ConsumptionBaselineDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const baselineByProduct = useMemo(
    () => new Map(baselines.map((baseline) => [baseline.product_id, baseline])),
    [baselines]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (editingProduct) setEditingProduct(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, editingProduct, onClose]);

  const actualProducts = products.filter(
    (product) => view.consumptionStats.get(product.id)?.source === "usage"
  );
  const baselineProducts = products.filter(
    (product) =>
      view.consumptionStats.get(product.id)?.source === "recalled_baseline"
  );
  const learningProducts = products.filter(
    (product) => !view.consumptionStats.get(product.id)?.source
  );

  function beginEdit(product: InventoryProduct) {
    const baseline = baselineByProduct.get(product.id);
    setEditingProduct(product);
    setDraft(baseline ? {
      startedOn: baseline.started_on,
      endedOn: baseline.ended_on,
      consumedQuantity: String(baseline.consumed_quantity),
      consumerCount: String(baseline.consumer_count),
      note: baseline.note || ""
    } : emptyDraft());
    setFormError(null);
  }

  async function saveBaseline(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;
    setFormError(null);
    try {
      await onSaveBaseline(editingProduct, draft);
      setEditingProduct(null);
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "회상 소비 기준을 저장하지 못했습니다."
      );
    }
  }

  async function deleteBaseline() {
    if (!editingProduct) return;
    setFormError(null);
    try {
      await onDeleteBaseline(editingProduct);
      setEditingProduct(null);
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "회상 소비 기준을 삭제하지 못했습니다."
      );
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
        className="learning-status-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-status-title"
      >
        <div className="editor-heading">
          <div>
            <h2 id="learning-status-title">소비 관찰 현황</h2>
            <p>앱은 첫 실제 주기부터 추정하고, 기록이 늘수록 자동으로 보정합니다.</p>
          </div>
          <button type="button" className="icon-button" aria-label="닫기" disabled={busy} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="learning-status-summary" aria-label="소비 관찰 현황 요약">
          <span>실제 사용 <strong>{actualProducts.length}</strong></span>
          <span>회상 기준 사용 <strong>{baselineProducts.length}</strong></span>
          <span>관찰 중 <strong>{learningProducts.length}</strong></span>
        </div>

        {editingProduct ? (
          <form className="action-form baseline-form" onSubmit={(event) => void saveBaseline(event)}>
            <div className="form-section-heading-copy">
              <h3>{editingProduct.name} 회상 소비 기준</h3>
              <p>정확한 사건 기록이 아니라 실제 사용 전의 임시 예측 출발점입니다.</p>
            </div>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">대략적인 시작일</span>
                <DateInput value={draft.startedOn} onChange={(value) => setDraft((current) => ({ ...current, startedOn: value }))} />
              </label>
              <label>
                <span className="field-label">대략적인 종료일</span>
                <DateInput value={draft.endedOn} onChange={(value) => setDraft((current) => ({ ...current, endedOn: value }))} />
              </label>
            </div>
            <div className="form-grid two-columns">
              {usageTrackingOf(editingProduct) === "decrement" ? (
                <label>
                  <span className="field-label">그 기간 총사용량</span>
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={draft.consumedQuantity}
                      onChange={(event) => setDraft((current) => ({ ...current, consumedQuantity: event.target.value }))}
                    />
                    <span>{editingProduct.unit_label}</span>
                  </div>
                </label>
              ) : (
                <div className="read-only-field">
                  <span className="field-label">대상</span>
                  <strong>제품 1{editingProduct.unit_label}의 사용 기간</strong>
                </div>
              )}
              <label>
                <span className="field-label">함께 사용한 인원</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={draft.consumerCount}
                    onChange={(event) => setDraft((current) => ({ ...current, consumerCount: event.target.value }))}
                  />
                  <span>명</span>
                </div>
              </label>
            </div>
            <label>
              <span className="field-label">메모 · 선택</span>
              <textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} />
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="editor-actions baseline-actions">
              {baselineByProduct.has(editingProduct.id) ? (
                <button type="button" className="danger-outline-button" disabled={busy} onClick={() => void deleteBaseline()}>
                  회상 기준 삭제
                </button>
              ) : null}
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingProduct(null)}>취소</button>
              <button type="submit" className="primary-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
            </div>
          </form>
        ) : (
          <>
            {learningProducts.length ? (
              <ul className="learning-status-list">
                {learningProducts.map((product) => {
                  const estimate = view.estimates.get(product.id);
                  const baseline = baselineByProduct.get(product.id);
                  return (
                    <li key={product.id}>
                      <div>
                        <strong>{product.name}</strong>
                        <span>{learningMessage(product, estimate?.useSampleCount || 0)}</span>
                      </div>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => beginEdit(product)}>
                        {baseline ? "회상 기준 수정" : "회상 기준 추가"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="learning-status-empty">
                <strong>모든 제품에 소비 속도 근거가 있습니다.</strong>
                <span>실제 기록이 추가되면 앱이 기존 추정을 자동으로 보정합니다.</span>
              </div>
            )}

            {baselines.length ? (
              <section className="preserved-baselines">
                <h3>보존된 회상 기준</h3>
                <p>실제 사용이 우선된 뒤에도 당시 판단 근거는 남겨둡니다.</p>
                <ul>
                  {baselines.map((baseline) => {
                    const product = products.find((candidate) => candidate.id === baseline.product_id);
                    if (!product) return null;
                    return (
                      <li key={baseline.id}>
                        <button type="button" disabled={busy} onClick={() => beginEdit(product)}>
                          <strong>{product.name}</strong>
                          <span>{formatDate(baseline.started_on)}–{formatDate(baseline.ended_on)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <div className="dialog-actions">
              <button type="button" className="primary-button" onClick={onClose}>닫기</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function emptyDraft(): ConsumptionBaselineDraft {
  return {
    startedOn: "",
    endedOn: "",
    consumedQuantity: "",
    consumerCount: "1",
    note: ""
  };
}

function learningMessage(product: InventoryProduct, useSampleCount: number) {
  if (usageTrackingOf(product) === "cycle") return "완료된 개봉–소진 주기 1회 필요";
  const remaining = Math.max(0, 2 - useSampleCount);
  return remaining > 0
    ? `서로 다른 날짜의 사용 기록 ${remaining}일 더 필요`
    : "사용 속도 계산 가능";
}
