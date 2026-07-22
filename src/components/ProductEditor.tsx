import { useEffect, useState } from "react";
import { formatQuantity, isStockInitialized } from "../lib/inventory";
import type {
  InventoryProduct,
  InventoryStore,
  ProductDraft,
  ProductCategory,
  TrackingMode
} from "../types";
import { PRODUCT_CATEGORIES } from "../types";
import { CloseIcon } from "./Icons";

interface ProductEditorProps {
  product: InventoryProduct | null;
  stores: InventoryStore[];
  busy: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSubmit: (draft: ProductDraft) => Promise<void>;
  onArchive: (() => Promise<void>) | null;
  onDelete: (() => Promise<void>) | null;
}

export function ProductEditor({
  product,
  stores,
  busy,
  canDelete,
  onClose,
  onSubmit,
  onArchive,
  onDelete
}: ProductEditorProps) {
  const [draft, setDraft] = useState<ProductDraft>(() => makeDraft(product));
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);

  useEffect(() => {
    setDraft(makeDraft(product));
    setFormError(null);
    setConfirmAction(null);
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
          unitLabel: "통",
          packageSize: "",
          capacityUnit: "ml",
          currentConsumerCount: "1"
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

    const lowStockThreshold = Number(draft.lowStockThreshold);
    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
      setFormError("구매 기준은 0 이상의 숫자로 입력해주세요.");
      return;
    }

    if (draft.trackingMode === "cycle") {
      if (!draft.packageSize.trim() || Number(draft.packageSize) <= 0) {
        setFormError("제품 1개의 전체 용량을 입력해주세요.");
        return;
      }
      if (!draft.capacityUnit.trim()) {
        setFormError("제품 용량 단위를 입력해주세요.");
        return;
      }
      if (draft.unitLabel.trim().toLowerCase() === draft.capacityUnit.trim().toLowerCase()) {
        setFormError("재고 단위에는 통·병·봉처럼 포장 개수를 나타내는 말을 입력해주세요.");
        return;
      }
      if (!Number.isInteger(lowStockThreshold)) {
        setFormError("개봉·소진 제품의 구매 기준은 포장 개수 정수로 입력해주세요.");
        return;
      }
      const consumerCount = Number(draft.currentConsumerCount);
      if (!Number.isInteger(consumerCount) || consumerCount < 1) {
        setFormError("현재 사용하는 사람 수는 1명 이상의 정수로 입력해주세요.");
        return;
      }
    }

    try {
      await onSubmit({
        ...draft,
        unitLabel: draft.unitLabel.trim(),
        capacityUnit:
          draft.trackingMode === "cycle" ? draft.capacityUnit.trim() : "",
        packageSize:
          draft.trackingMode === "cycle" ? draft.packageSize : ""
      });
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "제품을 저장하지 못했습니다.");
    }
  }

  async function archiveProduct() {
    if (!onArchive) return;
    if (confirmAction !== "archive") {
      setConfirmAction("archive");
      return;
    }

    setFormError(null);
    try {
      await onArchive();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "제품을 보관하지 못했습니다.");
      setConfirmAction(null);
    }
  }

  async function deleteProduct() {
    if (!onDelete || !canDelete) return;
    if (confirmAction !== "delete") {
      setConfirmAction("delete");
      return;
    }

    setFormError(null);
    try {
      await onDelete();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "제품을 삭제하지 못했습니다.");
      setConfirmAction(null);
    }
  }

  const isEdit = Boolean(product);
  const isCycle = draft.trackingMode === "cycle";
  const archiveDisabled = Boolean(product?.active_opened_on);

  return (
    <div
      className="editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="product-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
      >
        <div className="editor-heading">
          <div>
            <h2 id="product-editor-title">{isEdit ? "제품 설정" : "제품 추가"}</h2>
            <p>
              {isEdit
                ? "이름과 구매 기준을 수정합니다."
                : "제품 항목을 먼저 만들고 현재 재고는 나중에 연결할 수 있습니다."}
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
              <span className="field-label">카테고리</span>
              <select
                value={draft.category}
                onChange={(event) => update("category", event.target.value as ProductCategory)}
              >
                {PRODUCT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
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
            <h3>재고·사용 기록 방식</h3>
            <div className="mode-picker">
              <ModeButton
                mode="count"
                selected={draft.trackingMode === "count"}
                disabled={isEdit}
                symbol="−1"
                title="개수 직접 차감"
                description="소고기 5인분처럼 사용할 때 수량을 뺌"
                onSelect={() => selectTrackingMode("count")}
              />
              <ModeButton
                mode="cycle"
                selected={draft.trackingMode === "cycle"}
                disabled={isEdit}
                symbol="↻"
                title="개봉 → 소진"
                description="오일 2통처럼 개수로 재고를 세고 한 통씩 사용"
                onSelect={() => selectTrackingMode("cycle")}
              />
            </div>
            {isEdit ? (
              <p className="field-hint">
                기존 기록의 단위가 바뀌지 않도록 등록 후 방식은 고정됩니다.
              </p>
            ) : null}
          </section>

          <section className="form-section">
            <h3>{isCycle ? "포장 단위 재고" : "개수 재고"}</h3>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">재고 단위</span>
                <input
                  value={draft.unitLabel}
                  placeholder={isCycle ? "통, 병, 봉" : "개, 팩, 인분"}
                  onChange={(event) => update("unitLabel", event.target.value)}
                />
                {isCycle ? (
                  <span className="field-hint">ml·g가 아니라 재고로 세는 통·병·봉 단위를 입력합니다.</span>
                ) : null}
              </label>
              {isEdit ? <ReadOnlyQuantity product={product} /> : null}
            </div>
            {!isEdit ? (
              <p className="field-hint">
                저장 후 첫 입고를 기록하거나 카드에서 현재 재고를 설정하면 계산을 시작합니다.
              </p>
            ) : null}
          </section>

          {isCycle ? (
            <section className="form-section">
              <h3>제품 1개 정보</h3>
              <div className="form-grid two-columns">
                <label>
                  <span className="field-label">제품 1개 전체 용량</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={draft.packageSize}
                    placeholder="예: 1600"
                    onChange={(event) => update("packageSize", event.target.value)}
                  />
                </label>
                <label>
                  <span className="field-label">제품 용량 단위</span>
                  <input
                    value={draft.capacityUnit}
                    placeholder="ml, g"
                    onChange={(event) => update("capacityUnit", event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span className="field-label">현재 사용하는 사람 수</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.currentConsumerCount}
                  onChange={(event) => update("currentConsumerCount", event.target.value)}
                />
                <span className="field-hint">
                  제품을 개봉할 때 날짜와 현재 잔량을 입력하면 한 통의 실제 사용 기간을 학습합니다.
                </span>
              </label>
            </section>
          ) : null}

          <section className="form-section">
            <h3>구매 기준</h3>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">
                  현재 재고가 몇 {draft.unitLabel || "단위"} 이하일 때?
                </span>
                <input
                  type="number"
                  min="0"
                  step={isCycle ? "1" : "any"}
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
            <p className="field-hint">
              {isCycle
                ? "g·ml 잔량이 아니라 통·병·봉 개수와 예상 잔여일로 구매 필요를 판단합니다."
                : "현재 개수와 예상 잔여일 중 하나가 기준에 닿으면 구매 필요로 표시합니다."}
            </p>
          </section>

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
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
              취소
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>

          {isEdit ? (
            <section className="product-management-section">
              <div className="product-management-heading">
                <h3>제품 관리</h3>
                <p>기록을 보존하려면 삭제 대신 보관을 사용합니다.</p>
              </div>

              <div className="product-management-action">
                <div>
                  <strong>제품 보관</strong>
                  <span>
                    {archiveDisabled
                      ? "현재 사용 중인 제품은 다 쓴 뒤 보관할 수 있습니다."
                      : "기본 목록에서만 숨기고 모든 재고·사용·구매 기록은 유지합니다."}
                  </span>
                </div>
                <button
                  type="button"
                  className={confirmAction === "archive" ? "management-confirm-button" : "secondary-button"}
                  disabled={busy || archiveDisabled}
                  onClick={() => void archiveProduct()}
                >
                  {confirmAction === "archive" ? "한 번 더 눌러 보관" : "제품 보관"}
                </button>
              </div>

              <div className="product-management-action delete-action">
                <div>
                  <strong>잘못 만든 제품 삭제</strong>
                  <span>
                    {canDelete
                      ? "실사용·구매 기록이 없어 영구 삭제할 수 있습니다."
                      : "실사용 또는 구매 기록이 있어 삭제할 수 없습니다. 제품 보관을 사용해주세요."}
                  </span>
                </div>
                <button
                  type="button"
                  className={confirmAction === "delete" ? "danger-confirm-button" : "danger-outline-button"}
                  disabled={busy || !canDelete}
                  onClick={() => void deleteProduct()}
                >
                  {confirmAction === "delete" ? "한 번 더 눌러 영구 삭제" : "영구 삭제"}
                </button>
              </div>
            </section>
          ) : null}
        </form>
      </section>
    </div>
  );
}

function ReadOnlyQuantity({ product }: { product: InventoryProduct | null }) {
  return (
    <div className="read-only-field">
      <span className="field-label">현재 실제 재고</span>
      <strong>
        {product && isStockInitialized(product)
          ? `${formatQuantity(product.current_quantity)}${product.unit_label}`
          : "재고 미설정"}
      </strong>
      <small>수량은 카드의 ‘현재 재고 설정’ 또는 ‘재고 정정’에서 바꿉니다.</small>
    </div>
  );
}

function ModeButton({
  mode,
  selected,
  disabled,
  symbol,
  title,
  description,
  onSelect
}: {
  mode: TrackingMode;
  selected: boolean;
  disabled: boolean;
  symbol: string;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`mode-card${selected ? " selected" : ""}`}
      aria-pressed={selected}
      data-mode={mode}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="mode-symbol" aria-hidden="true">{symbol}</span>
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
    category: product?.category || "미분류",
    trackingMode: product?.tracking_mode || "count",
    unitLabel: product?.unit_label || "개",
    lowStockThreshold: String(product?.low_stock_threshold ?? 1),
    alertDays: String(product?.alert_days ?? 30),
    packageSize:
      product?.package_size === null || product?.package_size === undefined
        ? ""
        : String(product.package_size),
    capacityUnit: product?.capacity_unit || "",
    currentConsumerCount: String(product?.current_consumer_count ?? 1),
    preferredStoreId: product?.preferred_store_id || "",
    notes: product?.notes || ""
  };
}
