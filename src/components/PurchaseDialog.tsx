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

export type PurchaseDialogMode = "history" | "edit" | "list";
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
  onEditPurchase: (purchase: InventoryPurchase) => void;
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
  onDelete,
  onEditPurchase
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
  const duplicateHistoryDates = useMemo(() => {
    if (!historyDraft.datesText.trim() || !historyDraft.storeId) return [];
    try {
      const dates = parsePurchaseDates(historyDraft.datesText);
      const existingDates = new Set(
        purchases
          .filter((item) => item.store_id === historyDraft.storeId)
          .map((item) => item.purchased_on)
      );
      return dates.filter((date) => existingDates.has(date));
    } catch {
      return [];
    }
  }, [historyDraft.datesText, historyDraft.storeId, purchases]);

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
      setFormError(caught instanceof Error ? caught.message : "과거 구매 기록을 수정하지 못했습니다.");
    }
  }

  async function submitHistory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!historyDraft.storeId) {
      setFormError("쇼핑몰을 선택해주세요.");
      return;
    }

    const commonError = validateHistoryPurchaseFields(historyDraft);
    if (commonError) {
      setFormError(commonError);
      return;
    }
    if (duplicateHistoryDates.length > 0 && !historyDraft.allowDuplicateDates) {
      setFormError("이미 같은 날짜·쇼핑몰의 기록이 있습니다. 별도 구매가 맞다면 확인란을 선택해주세요.");
      return;
    }

    try {
      parsePurchaseDates(historyDraft.datesText);
      await onSubmitHistory(historyDraft);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "과거 구매 기록을 저장하지 못했습니다.");
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
      setFormError(caught instanceof Error ? caught.message : "과거 구매 기록을 삭제하지 못했습니다.");
    }
  }

  const heading = mode === "history"
    ? "과거 구매 기록 추가"
    : mode === "list"
      ? "전체 구매 기록"
      : "과거 구매 기록 수정";
  const description = mode === "history"
    ? "과거에 구매한 기록을 날짜·수량·용량과 함께 입력합니다."
    : mode === "list"
      ? "연도별 기록을 모두 확인하고 잘못 입력한 항목을 수정할 수 있습니다."
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
            <span>가격·구매처·구매 간격을 확인하는 자료로만 사용하며 소비량 학습에는 포함하지 않습니다. 실제로 들어온 물건은 입고로 따로 기록합니다.</span>
          </div>
        ) : null}

        {mode === "history" ? (
          <form className="action-form" onSubmit={(event) => void submitHistory(event)}>
            <PurchaseCommonFields
              product={product}
              stores={stores}
              values={historyDraft}
              onChange={(key, value) => updateHistoryDraft(key, value)}
            />

            <label>
              <span className="field-label">구매 날짜</span>
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

            {duplicateHistoryDates.length > 0 ? (
              <div className="duplicate-purchase-warning" role="alert">
                <strong>같은 날짜·쇼핑몰 기록이 이미 있습니다.</strong>
                <span>{duplicateHistoryDates.map(formatDate).join(", ")}</span>
                <label>
                  <input
                    type="checkbox"
                    checked={historyDraft.allowDuplicateDates}
                    onChange={(event) => updateHistoryDraft("allowDuplicateDates", event.target.checked)}
                  />
                  같은 날의 별도 구매가 맞습니다
                </label>
              </div>
            ) : null}

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
        ) : mode === "list" ? (
          <PurchaseHistoryList
            product={product}
            purchases={purchases}
            stores={stores}
            busy={busy}
            onEdit={onEditPurchase}
            onClose={onClose}
          />
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
              <span className="field-hint">달력에서 선택하거나 직접 입력할 수 있습니다.</span>
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
  const purchaseUnit = product.unit_label;

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
    datesText: "",
    packageCount: "1",
    packageSize:
      product.package_size === null || product.package_size === undefined
        ? ""
        : String(product.package_size),
    packageUnit: product.capacity_unit || "",
    allowDuplicateDates: false
  };
}

function validateHistoryPurchaseFields(values: PurchaseHistoryDraft): string | null {
  const packageCount = Number(values.packageCount);
  if (!Number.isInteger(packageCount) || packageCount < 1) {
    return "구매 수량을 1 이상의 정수로 입력해주세요.";
  }
  const hasSize = Boolean(values.packageSize.trim());
  const hasUnit = Boolean(values.packageUnit.trim());
  if (hasSize !== hasUnit) return "제품 용량과 용량 단위를 함께 입력해주세요.";
  if (hasSize && Number(values.packageSize) <= 0) return "제품 용량은 0보다 커야 합니다.";
  return null;
}

function PurchaseHistoryList({
  product,
  purchases,
  stores,
  busy,
  onEdit,
  onClose
}: {
  product: InventoryProduct;
  purchases: InventoryPurchase[];
  stores: InventoryStore[];
  busy: boolean;
  onEdit: (purchase: InventoryPurchase) => void;
  onClose: () => void;
}) {
  const storeById = new Map(stores.map((store) => [store.id, store.name]));
  const dateCounts = purchases.reduce((counts, purchase) => {
    counts.set(purchase.purchased_on, (counts.get(purchase.purchased_on) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const years = purchases.reduce((groups, purchase) => {
    const year = purchase.purchased_on.slice(0, 4);
    const list = groups.get(year) || [];
    list.push(purchase);
    groups.set(year, list);
    return groups;
  }, new Map<string, InventoryPurchase[]>());

  if (purchases.length === 0) {
    return <p className="history-empty purchase-history-empty">입력한 구매 기록이 없습니다.</p>;
  }

  return (
    <div className="full-purchase-history">
      <div className="full-purchase-history-summary">
        <strong>{purchases.length}건</strong>
        <span>총 {formatQuantity(purchases.reduce((sum, item) => sum + item.package_count, 0))}{product.unit_label}</span>
      </div>
      {[...years.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([year, items]) => (
          <section key={year} className="purchase-history-year">
            <div className="purchase-history-year-heading">
              <h3>{year}년</h3>
              <span>{items.length}건 · {formatQuantity(items.reduce((sum, item) => sum + item.package_count, 0))}{product.unit_label}</span>
            </div>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" disabled={busy} onClick={() => onEdit(item)}>
                    <span className="purchase-history-line">
                      <span className="purchase-history-date">
                        {formatDate(item.purchased_on)}
                        {(dateCounts.get(item.purchased_on) || 0) > 1 ? <small>같은 날 {dateCounts.get(item.purchased_on)}건</small> : null}
                      </span>
                      <strong>{formatPurchaseAmount(item, product)}</strong>
                      <small>{storeById.get(item.store_id) || "쇼핑몰 미확인"}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      <div className="dialog-actions full-history-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
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
  const countUnit = product.unit_label;
  const count = `${formatQuantity(purchase.package_count)}${countUnit}`;
  if (purchase.package_size === null || !purchase.package_unit) return count;
  return `${count} · ${formatQuantity(purchase.package_size)}${purchase.package_unit}씩`;
}
