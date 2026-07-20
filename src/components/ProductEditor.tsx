import { useEffect, useState } from "react";
import { formatQuantity, todayIso } from "../lib/inventory";
import type {
  InventoryProduct,
  InventoryStore,
  ProductDraft,
  TrackingMode
} from "../types";
import { CloseIcon } from "./Icons";

interface ProductEditorProps {
  product: InventoryProduct | null;
  stores: InventoryStore[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: ProductDraft) => Promise<void>;
}

export function ProductEditor({
  product,
  stores,
  busy,
  onClose,
  onSubmit
}: ProductEditorProps) {
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

  function selectTrackingMode(mode: TrackingMode) {
    setDraft((current) => {
      if (mode === current.trackingMode) return current;
      if (mode === "cycle") {
        return {
          ...current,
          trackingMode: mode,
          unitLabel: "",
          packageSize: "",
          capacityUnit: ""
        };
      }
      return {
        ...current,
        trackingMode: mode,
        unitLabel: "개",
        packageSize: "",
        capacityUnit: "",
        currentConsumerCount: "1"
      };
    });
  }

  function updateCapacityUnit(value: string) {
    setDraft((current) => ({
      ...current,
      capacityUnit: value,
      unitLabel: value
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!draft.name.trim()) {
      setFormError("제품명을 입력해주세요.");
      return;
    }

    if (draft.trackingMode === "count") {
      if (!draft.unitLabel.trim()) {
        setFormError("재고 단위를 입력해주세요.");
        return;
      }
    } else {
      if (!draft.capacityUnit.trim()) {
        setFormError("용량 단위를 입력해주세요.");
        return;
      }
      if (!draft.packageSize.trim() || Number(draft.packageSize) <= 0) {
        setFormError("새 제품 1개의 전체 용량을 입력해주세요.");
        return;
      }
    }

    try {
      await onSubmit({
        ...draft,
        unitLabel:
          draft.trackingMode === "cycle"
            ? draft.capacityUnit.trim()
            : draft.unitLabel.trim()
      });
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "제품을 저장하지 못했습니다.");
    }
  }

  const isEdit = Boolean(product);
  const isCapacity = draft.trackingMode === "cycle";
  const stockUnit = isCapacity ? draft.capacityUnit : draft.unitLabel;

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
              <input
                value={draft.name}
                autoFocus={!isEdit}
                placeholder="예: 코코넛 오일"
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <label>
              <span className="field-label">주구매처 · 선택</span>
              <select
                value={draft.preferredStoreId}
                onChange={(event) => update("preferredStoreId", event.target.value)}
              >
                <option value="">미지정</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
              <span className="field-hint">구매처별 보기에서 이 제품이 묶일 위치입니다.</span>
            </label>
          </section>

          <section className="form-section">
            <h3>재고 기준</h3>
            <div className="mode-picker">
              <ModeButton
                mode="count"
                selected={draft.trackingMode === "count"}
                disabled={isEdit}
                title="개수로 관리"
                description="소고기 4통, 토너 3병처럼 개수를 셈"
                onSelect={() => selectTrackingMode("count")}
              />
              <ModeButton
                mode="cycle"
                selected={draft.trackingMode === "cycle"}
                disabled={isEdit}
                title="용량으로 관리"
                description="오일 1600ml, 수세미 100g처럼 남은 양을 기록"
                onSelect={() => selectTrackingMode("cycle")}
              />
            </div>
            {isEdit ? <p className="field-hint">기존 기록과 단위가 섞이지 않도록 등록 후 기준은 고정됩니다.</p> : null}
          </section>

          {isCapacity ? (
            <section className="form-section">
              <h3>용량 재고</h3>
              <div className="form-grid two-columns">
                <label>
                  <span className="field-label">용량 단위</span>
                  <input
                    value={draft.capacityUnit}
                    placeholder="g, ml"
                    onChange={(event) => updateCapacityUnit(event.target.value)}
                  />
                </label>
                <label>
                  <span className="field-label">새 제품 1개의 전체 용량</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={draft.packageSize}
                    placeholder="예: 200"
                    onChange={(event) => update("packageSize", event.target.value)}
                  />
                </label>
              </div>

              {!isEdit ? (
                <label>
                  <span className="field-label">현재 남은 총 용량</span>
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={draft.initialQuantity}
                      onChange={(event) => update("initialQuantity", event.target.value)}
                    />
                    <span>{draft.capacityUnit || "단위"}</span>
                  </div>
                  <span className="field-hint">예: 200g 제품이 절반 남았다면 100을 입력합니다.</span>
                </label>
              ) : (
                <div className="read-only-field">
                  <span className="field-label">현재 남은 총 용량</span>
                  <strong>{formatQuantity(product?.current_quantity || 0)}{product?.unit_label}</strong>
                  <small>남은 양은 카드의 ‘재고 정정’에서 바꿉니다.</small>
                </div>
              )}

              <label>
                <span className="field-label">현재 사용하는 사람 수</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.currentConsumerCount}
                  onChange={(event) => update("currentConsumerCount", event.target.value)}
                />
                <span className="field-hint">과거 2명이 쓴 기록을 지금 1명 기준으로 자동 보정합니다.</span>
              </label>
            </section>
          ) : (
            <section className="form-section">
              <h3>개수 재고</h3>
              <div className="form-grid two-columns">
                <label>
                  <span className="field-label">재고 단위</span>
                  <input
                    value={draft.unitLabel}
                    placeholder="통, 팩, 병"
                    onChange={(event) => update("unitLabel", event.target.value)}
                  />
                </label>
                {!isEdit ? (
                  <label>
                    <span className="field-label">현재 실제 재고</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
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
          )}

          <section className="form-section">
            <h3>구매 기준</h3>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">몇 {stockUnit || (isCapacity ? "단위" : "개")} 이하일 때 빨간불?</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.lowStockThreshold}
                  onChange={(event) => update("lowStockThreshold", event.target.value)}
                />
              </label>
              <label>
                <span className="field-label">예상 소진 며칠 전부터?</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.alertDays}
                  onChange={(event) => update("alertDays", event.target.value)}
                />
              </label>
            </div>
          </section>

          {!isEdit ? (
            <label className="form-section compact-section">
              <span className="field-label">최초 재고 확인일</span>
              <input
                type="date"
                max={todayIso()}
                value={draft.occurredOn}
                onChange={(event) => update("occurredOn", event.target.value)}
              />
            </label>
          ) : null}

          <label className="form-section compact-section">
            <span className="field-label">메모 · 선택</span>
            <textarea
              value={draft.notes}
              placeholder="제품 설명이나 보관 메모"
              onChange={(event) => update("notes", event.target.value)}
            />
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
      <span className="mode-symbol" aria-hidden="true">{mode === "count" ? "−1" : "g"}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

function makeDraft(product: InventoryProduct | null): ProductDraft {
  const isCapacity = product?.tracking_mode === "cycle";
  const capacityUnit = product?.capacity_unit || (isCapacity ? product?.unit_label || "" : "");

  return {
    name: product?.name || "",
    trackingMode: product?.tracking_mode || "count",
    unitLabel: isCapacity ? capacityUnit : product?.unit_label || "개",
    initialQuantity: product ? String(product.current_quantity) : "0",
    lowStockThreshold: String(product?.low_stock_threshold ?? 1),
    alertDays: String(product?.alert_days ?? 30),
    packageSize: product?.package_size === null || product?.package_size === undefined ? "" : String(product.package_size),
    capacityUnit,
    currentConsumerCount: String(product?.current_consumer_count ?? 1),
    preferredStoreId: product?.preferred_store_id || "",
    notes: product?.notes || "",
    occurredOn: todayIso()
  };
}
