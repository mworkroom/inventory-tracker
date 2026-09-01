import { useEffect, useState } from "react";
import { formatQuantity, isStockInitialized } from "../lib/inventory";
import { getProductStoreIds } from "../lib/inventoryStores";
import { usageTrackingOf } from "../lib/observationAnalysis";
import type {
  InventoryProduct,
  InventoryProductSaleSchedule,
  InventoryStore,
  ProductCategory,
  ProductDraft,
  SaleScheduleDraft,
  UsageTracking
} from "../types";
import { PRODUCT_CATEGORIES } from "../types";
import { CloseIcon } from "./Icons";

interface ProductEditorProps {
  product: InventoryProduct | null;
  stores: InventoryStore[];
  saleSchedules: InventoryProductSaleSchedule[];
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
  saleSchedules,
  busy,
  canDelete,
  onClose,
  onSubmit,
  onArchive,
  onDelete
}: ProductEditorProps) {
  const [draft, setDraft] = useState<ProductDraft>(() =>
    makeDraft(product, saleSchedules)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);

  useEffect(() => {
    setDraft(makeDraft(product, saleSchedules));
    setFormError(null);
    setConfirmAction(null);
  }, [product, saleSchedules]);

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

  function toggleStore(storeId: string) {
    setDraft((current) => {
      const selected = current.storeIds.includes(storeId);
      return {
        ...current,
        storeIds: selected
          ? current.storeIds.filter((id) => id !== storeId)
          : [...current.storeIds, storeId],
        saleSchedules: selected
          ? current.saleSchedules.filter((schedule) => schedule.storeId !== storeId)
          : current.saleSchedules
      };
    });
  }

  function addSaleSchedule() {
    const storeId = draft.storeIds[0];
    if (!storeId) {
      setFormError("정기 세일을 추가하려면 먼저 쇼핑몰을 선택해주세요.");
      return;
    }
    setFormError(null);
    update("saleSchedules", [
      ...draft.saleSchedules,
      {
        storeId,
        name: "",
        saleMonth: String(new Date().getMonth() + 1),
        saleDay: "1"
      }
    ]);
  }

  function updateSaleSchedule(
    index: number,
    key: keyof SaleScheduleDraft,
    value: string
  ) {
    update(
      "saleSchedules",
      draft.saleSchedules.map((schedule, scheduleIndex) =>
        scheduleIndex === index ? { ...schedule, [key]: value } : schedule
      )
    );
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
    try {
      await onSubmit(draft);
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "제품을 저장하지 못했습니다."
      );
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
      setFormError(caught instanceof Error ? caught.message : "제품을 숨기지 못했습니다.");
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
  const isCycle = draft.usageTracking === "cycle";
  const trackingLocked = Boolean(product?.active_opened_on);
  const archiveDisabled = trackingLocked;

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
              제품 사실과 앞으로의 구매 계획만 입력합니다. 사용 시기는 실제 기록에서 자동으로 계산합니다.
            </p>
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
                placeholder="예: 더랩 세라 크림 50ml"
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
            <div className="shopping-mall-field">
              <span className="field-label" id="shopping-mall-label">쇼핑몰 · 복수 선택</span>
              <div className="shopping-mall-options" role="group" aria-labelledby="shopping-mall-label">
                {stores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    className={draft.storeIds.includes(store.id) ? "selected" : ""}
                    aria-pressed={draft.storeIds.includes(store.id)}
                    onClick={() => toggleStore(store.id)}
                  >
                    {store.name}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="form-section">
            <h3>기본 사용 기록 방식</h3>
            <div className="mode-picker">
              <ModeButton
                mode="decrement"
                selected={!isCycle}
                disabled={trackingLocked}
                symbol="−1"
                title="사용량 차감"
                description="쓸 때마다 실제 사용량을 기록"
                onSelect={() => update("usageTracking", "decrement")}
              />
              <ModeButton
                mode="cycle"
                selected={isCycle}
                disabled={trackingLocked}
                symbol="↻"
                title="개봉–소진 주기"
                description="제품 한 개의 개봉일과 다 쓴 날을 기록"
                onSelect={() => update("usageTracking", "cycle")}
              />
            </div>
            <p className="field-hint">
              {trackingLocked
                ? "진행 중인 개봉 주기를 끝낸 뒤 기록 방식을 바꿀 수 있습니다. 과거 기록은 그대로 보존됩니다."
                : "기록 방식은 미래 기록에만 적용되며 재고 단위와는 별개입니다."}
            </p>
          </section>

          <section className="form-section">
            <h3>재고와 제품 용량</h3>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">재고 단위</span>
                <input
                  value={draft.unitLabel}
                  placeholder="통, 병, 봉, 인분, 개"
                  onChange={(event) => update("unitLabel", event.target.value)}
                />
                <span className="field-hint">실제로 세고 구매하는 단위를 입력합니다.</span>
              </label>
              {isEdit ? <ReadOnlyQuantity product={product} /> : null}
            </div>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">제품 1개 용량 · 선택</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.packageSize}
                  placeholder="예: 50"
                  onChange={(event) => update("packageSize", event.target.value)}
                />
              </label>
              <label>
                <span className="field-label">용량 단위 · 선택</span>
                <input
                  value={draft.capacityUnit}
                  placeholder="ml, g"
                  onChange={(event) => update("capacityUnit", event.target.value)}
                />
              </label>
            </div>
            <p className="field-hint">용량과 단위는 둘 다 입력하거나 둘 다 비워둡니다.</p>
          </section>

          <section className="form-section">
            <h3>재고 알림 기준</h3>
            <div className="form-grid two-columns">
              <label>
                <span className="field-label">소비 속도를 모를 때 몇 {draft.unitLabel || "단위"} 이하?</span>
                <input
                  type="number"
                  min="0"
                  step={isCycle ? "1" : "any"}
                  value={draft.lowStockThreshold}
                  onChange={(event) => update("lowStockThreshold", event.target.value)}
                />
              </label>
              <label>
                <span className="field-label">예상 소진 며칠 전부터 알림?</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.alertDays}
                  onChange={(event) => update("alertDays", event.target.value)}
                />
              </label>
            </div>
            <p className="field-hint">실제 사용을 우선하고, 실제 사용 전에는 회상 소비 기준, 둘 다 없으면 재고 수량 기준을 사용합니다.</p>
          </section>

          <section className="form-section purchase-plan-form-section">
            <div className="form-section-heading-copy">
              <h3>정기 세일 일정 · 선택</h3>
              <p>반복되는 월·일, 쇼핑몰과 행사명만 등록합니다. 연도와 구매 수량은 앱이 계산합니다.</p>
            </div>
            {draft.saleSchedules.length ? (
              <div className="sale-schedule-editor-list">
                {draft.saleSchedules.map((schedule, index) => (
                  <div className="sale-schedule-editor-row" key={schedule.id || index}>
                    <label>
                      <span className="field-label">쇼핑몰</span>
                      <select
                        value={schedule.storeId}
                        onChange={(event) => updateSaleSchedule(index, "storeId", event.target.value)}
                      >
                        {draft.storeIds.map((storeId) => (
                          <option key={storeId} value={storeId}>
                            {stores.find((store) => store.id === storeId)?.name || "쇼핑몰"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sale-schedule-name-field">
                      <span className="field-label">행사명</span>
                      <input
                        value={schedule.name}
                        placeholder="예: 올영세일"
                        onChange={(event) => updateSaleSchedule(index, "name", event.target.value)}
                      />
                    </label>
                    <label>
                      <span className="field-label">월</span>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        step="1"
                        value={schedule.saleMonth}
                        onChange={(event) => updateSaleSchedule(index, "saleMonth", event.target.value)}
                      />
                    </label>
                    <label>
                      <span className="field-label">일</span>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        step="1"
                        value={schedule.saleDay}
                        onChange={(event) => updateSaleSchedule(index, "saleDay", event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button sale-schedule-remove"
                      onClick={() => update(
                        "saleSchedules",
                        draft.saleSchedules.filter((_, scheduleIndex) => scheduleIndex !== index)
                      )}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="field-hint">등록한 정기 세일 일정이 없습니다.</p>
            )}
            <button type="button" className="secondary-button" onClick={addSaleSchedule}>
              정기 세일 추가
            </button>
            <label className="sale-safety-field">
              <span className="field-label">세일 구매 후 남길 여유 재고</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.purchaseSafetyQuantity}
                  onChange={(event) => update("purchaseSafetyQuantity", event.target.value)}
                />
                <span>{draft.unitLabel || "개"}</span>
              </div>
            </label>
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
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>취소</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
          </div>

          {isEdit ? (
            <section className="product-management-section">
              <div className="product-management-heading"><h3>제품 관리</h3></div>
              <div className="product-management-action">
                <div>
                  <strong>목록에서 숨기기</strong>
                  <span>{archiveDisabled ? "현재 사용 중인 제품은 다 쓴 뒤 숨길 수 있습니다." : "기록은 유지하고 기본 목록에서만 숨깁니다."}</span>
                </div>
                <button
                  type="button"
                  className={confirmAction === "archive" ? "management-confirm-button" : "secondary-button"}
                  disabled={busy || archiveDisabled}
                  onClick={() => void archiveProduct()}
                >
                  {confirmAction === "archive" ? "한 번 더 눌러 숨기기" : "목록에서 숨기기"}
                </button>
              </div>
              <div className="product-management-action delete-action">
                <div>
                  <strong>잘못 만든 제품 삭제</strong>
                  <span>{canDelete ? "실사용·구매 기록이 없어 영구 삭제할 수 있습니다." : "기록이 있어 삭제할 수 없습니다."}</span>
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
  mode: UsageTracking;
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
      <span><strong>{title}</strong><small>{description}</small></span>
    </button>
  );
}

function makeDraft(
  product: InventoryProduct | null,
  saleSchedules: InventoryProductSaleSchedule[]
): ProductDraft {
  return {
    name: product?.name || "",
    category: product?.category || "미분류",
    usageTracking: product ? usageTrackingOf(product) : "decrement",
    unitLabel: product?.unit_label || "개",
    lowStockThreshold: String(product?.low_stock_threshold ?? 1),
    alertDays: String(product?.alert_days ?? 30),
    packageSize: product?.package_size == null ? "" : String(product.package_size),
    capacityUnit: product?.capacity_unit || "",
    storeIds: product ? getProductStoreIds(product) : [],
    purchaseSafetyQuantity: String(product?.purchase_safety_quantity ?? 0),
    saleSchedules: product
      ? saleSchedules
          .filter((schedule) => schedule.product_id === product.id)
          .map((schedule) => ({
            id: schedule.id,
            storeId: schedule.store_id || "",
            name: schedule.name,
            saleMonth: String(schedule.sale_month),
            saleDay: String(schedule.sale_day)
          }))
      : [],
    notes: product?.notes || ""
  };
}
