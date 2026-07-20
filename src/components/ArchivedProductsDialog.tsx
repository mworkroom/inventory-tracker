import { useEffect } from "react";
import { formatQuantity } from "../lib/inventory";
import type { InventoryProduct, InventoryStore } from "../types";
import { CloseIcon } from "./Icons";

interface ArchivedProductsDialogProps {
  products: InventoryProduct[];
  stores: InventoryStore[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRestore: (product: InventoryProduct) => Promise<void>;
}

export function ArchivedProductsDialog({
  products,
  stores,
  loading,
  busy,
  error,
  onClose,
  onRestore
}: ArchivedProductsDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const storeById = new Map(stores.map((store) => [store.id, store.name]));

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="archived-products-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archived-products-title"
      >
        <div className="editor-heading">
          <div>
            <h2 id="archived-products-title">보관된 제품</h2>
            <p>목록에서 숨긴 제품입니다. 모든 재고·사용·구매 기록은 그대로 유지됩니다.</p>
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

        {error ? <p className="form-error archived-products-error">{error}</p> : null}

        {loading ? (
          <div className="archived-products-loading">보관된 제품을 불러오고 있습니다.</div>
        ) : products.length ? (
          <ul className="archived-products-list">
            {products.map((product) => (
              <li key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <span>
                    현재 {formatQuantity(product.current_quantity)}{product.unit_label}
                    {product.preferred_store_id
                      ? ` · ${storeById.get(product.preferred_store_id) || "구매처 미지정"}`
                      : " · 구매처 미지정"}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary-button archived-restore-button"
                  disabled={busy}
                  onClick={() => void onRestore(product)}
                >
                  복원
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="archived-products-empty">
            <strong>보관된 제품이 없습니다.</strong>
            <span>제품 설정에서 ‘제품 보관’을 누르면 이곳에서 다시 복원할 수 있습니다.</span>
          </div>
        )}

        <div className="dialog-actions archived-dialog-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  );
}
