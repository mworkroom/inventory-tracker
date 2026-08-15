import { eventLabel, formatDate, formatQuantity } from "../lib/inventory";
import type { InventoryEvent, InventoryProduct } from "../types";
import { CloseIcon } from "./Icons";

interface InventoryHistoryDialogProps {
  product: InventoryProduct;
  events: InventoryEvent[];
  busy: boolean;
  onClose: () => void;
  onEdit: (event: InventoryEvent) => void;
}

export function InventoryHistoryDialog({
  product,
  events,
  busy,
  onClose,
  onEdit
}: InventoryHistoryDialogProps) {
  const productEvents = events
    .filter((event) => event.product_id === product.id)
    .sort((a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id)
    );
  const editableCount = productEvents.filter(isEditableEvent).length;
  const years = productEvents.reduce((groups, event) => {
    const year = event.occurred_on.slice(0, 4);
    const list = groups.get(year) || [];
    list.push(event);
    groups.set(year, list);
    return groups;
  }, new Map<string, InventoryEvent[]>());

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="action-dialog inventory-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-history-dialog-title"
      >
        <div className="editor-heading">
          <div>
            <span className="dialog-product-name">{product.name}</span>
            <h2 id="inventory-history-dialog-title">전체 재고 기록</h2>
            <p>입고·사용 기록은 어느 시점이든 수정하거나 삭제할 수 있습니다.</p>
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

        <div className="full-inventory-history">
          <div className="full-purchase-history-summary">
            <strong>{productEvents.length}건</strong>
            <span>수정·삭제 가능 {editableCount}건</span>
          </div>

          {[...years.entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([year, items]) => (
              <section key={year} className="purchase-history-year">
                <div className="purchase-history-year-heading">
                  <h3>{year}년</h3>
                  <span>{items.length}건</span>
                </div>
                <ul>
                  {items.map((event) => {
                    const content = (
                      <>
                        <span className="purchase-history-date">
                          {formatDate(event.occurred_on)}
                          {isEditableEvent(event) ? <small>수정·삭제</small> : null}
                        </span>
                        <span className="purchase-history-detail">
                          <strong>{eventLabel(event, product.unit_label)}</strong>
                          <small>
                            {formatQuantity(event.quantity_before)} → {formatQuantity(event.quantity_after)}{product.unit_label}
                          </small>
                        </span>
                      </>
                    );

                    return (
                      <li key={event.id}>
                        {isEditableEvent(event) ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`${formatDate(event.occurred_on)} ${event.event_type === "intake" ? "입고" : "사용"} 기록 수정 또는 삭제`}
                            onClick={() => onEdit(event)}
                          >
                            {content}
                          </button>
                        ) : (
                          <div className="inventory-history-row">{content}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

          <div className="dialog-actions full-history-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function isEditableEvent(event: InventoryEvent): boolean {
  return event.event_type === "intake" || event.event_type === "use";
}
