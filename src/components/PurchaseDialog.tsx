import { useEffect, useMemo, useState } from "react";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
  parsePurchaseDates,
  todayIso
} from "../lib/inventory";
import { getProductStoreIds } from "../lib/inventoryStores";
import type {
  InventoryProduct,
  InventoryPurchase,
  InventoryStore,
  PurchaseHistoryDraft,
  PurchaseDraft
} from "../types";
import { CloseIcon } from "./Icons";
import { DateInput } from "./DateInput";

export type PurchaseDialogMode = "history" | "edit";
type CommonPurchaseField = "storeId" | "packageCount" | "packageSize" | "packageUnit";

interface PurchaseDialogProps {
  product: InventoryProduct;
  stores: InventoryStore[];
  purchases: InventoryPurchase[];
  purchase: InventoryPurchase | null;
  mode: PurchaseDialogMode;
  busy: boolean;
  onClose: () => void;
  onSubmitEdit: (draft: PurchaseDraft) => Promise<void>;
  onSubmitHistory: (draft: PurchaseHistoryDraft) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
}

export function PurchaseDialog({
  product,
  stores,
  purchases,
  purchase,
  mode,
  busy,
  onClose,
  onSubmitEdit,
  onSubmitHistory,
  onDelete
}: PurchaseDialogProps) {
  const [draft, setDraft] = useState<PurchaseDraft>(() =>
    makePurchaseDraft(product, stores, purchases, purchase)
  );
  const [historyDraft, setHistoryDraft] = useState<PurchaseHistoryDraft>(() =>
    makeHistoryDraft(product, stores, purchases)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    setDraft(makePurchaseDraft(product, stores, purchases, purchase));
    setHistoryDraft(makeHistoryDraft(product, stores, purchases));
    setFormError(null);
    setDeleteArmed(false);
  }, [mode, product, purchase, purchases, stores]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const historyDateCount = useMemo(() => {
    if (!historyDraft.datesText.trim()) return 0;
    try {
      return parsePurchaseDates(historyDraft.datesText).length;
    } catch {
      return 0;
    }
  }, [historyDraft.datesText]);

  function updateDraft<K extends keyof PurchaseDraft>(key: K, value: PurchaseDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateHistoryDraft<K extends keyof PurchaseHistoryDraft>(
    key: K,
    value: PurchaseHistoryDraft[K]
  ) {
    setHistoryDraft((current) => ({ ...current, [key]: value }));
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const error = validateCommonPurchaseFields(draft);
    if (error) {
      setFormError(error);
      return;
    }

    try {
      await onSubmitEdit(draft);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "과거 구매일을 수정하지 못했습니다.");
    }
  }

  async function submitHistory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!historyDraft.storeId) {
      setFormError("쇼핑몰을 선택해주세요.");
      return;
    }

    try {
      parsePurchaseDates(historyDraft.datesText);
      await onSubmitHistory(historyDraft);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "과거 구매일을 저장하지 못했습니다.");
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
      setFormError(caught instanceof Error ? caught.message : "과거 구매일을 삭제하지 못했습니다.");
    }
  }

  const heading = mode === "history" ? "과거 구매일 추가" : "과거 구매일 수정";
  const description = mode === "history"
    ? "현재 재고와 별도로 참고할 과거 구매일을 하나 또는 여러 개 입력합니다."
    : "기존에 입력한 날짜와 상세 정보를 바로잡습니다.";

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="action-dialog purchase-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="purchase-dialog-title">{heading}</h2>
            <p>{description}</p>
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

        {mode === "history" ? (
          <div className="purchase-dialog-callout">
            <strong>현재 재고는 바뀌지 않습니다.</strong>
            <span>앞으로 물건이 들어오면 입고만 기록하면 재고와 재구매 간격에 함께 반영됩니다.</span>
          </div>
        ) : null}

        {mode === "history" ? (
          <form className="action-form" onSubmit={(event) => void submitHistory(event)}>
            <label>
              <span className="field-label">쇼핑몰</span>
              <select
                value={historyDraft.storeId}
                onChange={(event) => updateHistoryDraft("storeId", event.target.value)}
              >
                <option value="">선택</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="field-label">과거 구매일</span>
              <textarea
                autoFocus
                value={historyDraft.datesText}
                placeholder={"2/10/2024\n6/21/2024\n11/3/2024"}
                onChange={(event) => updateHistoryDraft("datesText", event.target.value)}
              />
              <span className="field-hint">
                한 줄에 하나씩 M/D/YYYY 또는 MM/DD/YYYY로 입력합니다. 한 날짜만 입력해도 됩니다.{" "}
                {historyDateCount > 0 ? `${historyDateCount}개 날짜를 찾았습니다.` : ""}
              </span>
            </label>

            {formError ? <p className="form-error">{formError}</p> : null}

            <div className="dialog-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
                취소
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "저장 중…" : `${historyDateCount || "여러"}개 저장`}
              </button>
            </div>
          </form>
        ) : (
          <form className="action-form" onSubmit={(event) => void submitEdit(event)}>
            <label>
              <span className="field-label">구매일</span>
              <DateInput
                max={todayIso()}
                autoFocus
                value={draft.purchasedOn}
                onChange={(value) => updateDraft("purchasedOn", value)}
              />
              <span className="field-hint">M/D/YYYY 또는 MM/DD/YYYY로 입력합니다.</span>
            </label>

            <PurchaseCommonFields
              product={product}
              stores={stores}
              values={draft}
              onChange={(key, value) => updateDraft(key, value)}
            />

            <div className="form-grid two-columns">
              <label>
                <span className="field-label">총 결제금액 · 선택</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.totalPrice}
                    placeholder="18900"
                    onChange={(event) => updateDraft("totalPrice", event.target.value)}
                  />
                  <span>원</span>
                </div>
              </label>
              <label>
                <span className="field-label">배송비 · 선택</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.shippingFee}
                    placeholder="0"
                    onChange={(event) => updateDraft("shippingFee", event.target.value)}
                  />
                  <span>원</span>
                </div>
              </label>
            </div>

            <label>
              <span className="field-label">메모 · 선택</span>
              <textarea
                value={draft.note}
                placeholder="예: 정기 할인 없이 급하게 구매"
                onChange={(event) => updateDraft("note", event.target.value)}
              />
            </label>

            {purchase ? (
              <div className="purchase-edit-summary">
                <span>{formatDate(purchase.purchased_on)}</span>
                <strong>
                  {formatPurchaseAmount(purchase, product)}
                  {purchase.total_price !== null ? ` · ${formatCurrency(purchase.total_price)}` : ""}
                </strong>
              </div>
            ) : null}

            {formError ? <p className="form-error">{formError}</p> : null}

            <div className={`dialog-actions${mode === "edit" ? " purchase-edit-actions" : ""}`}>
              {mode === "edit" ? (
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
                {busy ? "저장 중…" : "수정 저장"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function PurchaseCommonFields({
  product,
  stores,
  values,
  onChange
}: {
  product: InventoryProduct;
  stores: InventoryStore[];
  values: Pick<PurchaseDraft, CommonPurchaseField>;
  onChange: (key: CommonPurchaseField, value: string) => void;
}) {
  const purchaseUnit = product.tracking_mode === "count" ? product.unit_label : "개";

  return (
    <>
      <label>
        <span className="field-label">쇼핑몰</span>
        <select
          value={values.storeId}
          onChange={(event) => onChange("storeId", event.target.value)}
        >
          <option value="">선택</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{store.name}</option>
          ))}
        </select>
      </label>

      <div className="form-grid two-columns">
        <label>
          <span className="field-label">구매 수량</span>
          <div className="input-with-unit">
            <input
              type="number"
              min="1"
              step="1"
              value={values.packageCount}
              onChange={(event) => onChange("packageCount", event.target.value)}
            />
            <span>{purchaseUnit}</span>
          </div>
        </label>
        <label>
          <span className="field-label">제품 1개 용량 · 선택</span>
          <input
            type="number"
            min="0"
            step="any"
            value={values.packageSize}
            placeholder={product.package_size ? String(product.package_size) : "예: 5000"}
            onChange={(event) => onChange("packageSize", event.target.value)}
          />
        </label>
      </div>

      <label>
        <span className="field-label">용량 단위 · 선택</span>
        <input
          value={values.packageUnit}
          placeholder={product.capacity_unit || "g, ml"}
          onChange={(event) => onChange("packageUnit", event.target.value)}
        />
        <span className="field-hint">용량을 입력했다면 단위도 함께 입력합니다.</span>
      </label>
    </>
  );
}

function validateCommonPurchaseFields(
  values: PurchaseDraft
): string | null {
  if (!values.storeId) return "쇼핑몰을 선택해주세요.";
  const packageCount = Number(values.packageCount);
  if (!Number.isInteger(packageCount) || packageCount < 1) {
    return "구매 수량을 1 이상의 정수로 입력해주세요.";
  }

  const hasSize = Boolean(values.packageSize.trim());
  const hasUnit = Boolean(values.packageUnit.trim());
  if (hasSize !== hasUnit) return "제품 용량과 용량 단위를 함께 입력해주세요.";
  if (hasSize && Number(values.packageSize) <= 0) return "제품 용량은 0보다 커야 합니다.";

  if (!values.purchasedOn) {
    return "구매일을 입력해주세요.";
  }

  return null;
}

function makePurchaseDraft(
  product: InventoryProduct,
  stores: InventoryStore[],
  purchases: InventoryPurchase[],
  purchase: InventoryPurchase | null
): PurchaseDraft {
  return {
    purchasedOn: purchase?.purchased_on || todayIso(),
    storeId:
      purchase?.store_id ||
      defaultStoreId(product, stores, purchases),
    packageCount: String(purchase?.package_count ?? 1),
    packageSize:
      purchase?.package_size === null || purchase?.package_size === undefined
        ? product.package_size === null || product.package_size === undefined
          ? ""
          : String(product.package_size)
        : String(purchase.package_size),
    packageUnit: purchase?.package_unit || product.capacity_unit || "",
    totalPrice: purchase?.total_price === null || purchase?.total_price === undefined
      ? ""
      : String(purchase.total_price),
    shippingFee: purchase?.shipping_fee === null || purchase?.shipping_fee === undefined
      ? ""
      : String(purchase.shipping_fee),
    note: purchase?.note || ""
  };
}

function makeHistoryDraft(
  product: InventoryProduct,
  stores: InventoryStore[],
  purchases: InventoryPurchase[]
): PurchaseHistoryDraft {
  return {
    storeId: defaultStoreId(product, stores, purchases),
    datesText: ""
  };
}

function defaultStoreId(
  product: InventoryProduct,
  stores: InventoryStore[],
  purchases: InventoryPurchase[]
): string {
  return (
    purchases[0]?.store_id ||
    getProductStoreIds(product)[0] ||
    stores[0]?.id ||
    ""
  );
}

function formatPurchaseAmount(
  purchase: InventoryPurchase,
  product: InventoryProduct
): string {
  const countUnit = product.tracking_mode === "count" ? product.unit_label : "개";
  const count = `${formatQuantity(purchase.package_count)}${countUnit}`;
  if (purchase.package_size === null || !purchase.package_unit) return count;
  return `${count} · ${formatQuantity(purchase.package_size)}${purchase.package_unit}씩`;
}
