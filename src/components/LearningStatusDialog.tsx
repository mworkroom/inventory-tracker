import { useEffect } from "react";
import type { InventoryViewModel } from "../hooks/useInventoryViewModel";
import type { InventoryProduct } from "../types";
import { CloseIcon } from "./Icons";

interface LearningStatusDialogProps {
  products: InventoryProduct[];
  view: InventoryViewModel;
  onClose: () => void;
}

export function LearningStatusDialog({
  products,
  view,
  onClose
}: LearningStatusDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const learningProducts = products.filter(
    (product) => view.estimates.get(product.id)?.isLearning
  );
  const completedCount = products.length - learningProducts.length;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
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
            <h2 id="learning-status-title">학습 현황</h2>
            <p>
              사용 기록이 충분한지 확인합니다. 학습 상태는 메인 알림에
              표시되지 않습니다.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="learning-status-summary" aria-label="학습 현황 요약">
          <span>
            학습 완료 <strong>{completedCount}</strong>
          </span>
          <span>
            학습 중 <strong>{learningProducts.length}</strong>
          </span>
        </div>

        {learningProducts.length ? (
          <ul className="learning-status-list">
            {learningProducts.map((product) => {
              const estimate = view.estimates.get(product.id);
              return (
                <li key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.category || "미분류"}</span>
                  </div>
                  <small>{learningMessage(product, estimate?.useSampleCount || 0)}</small>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="learning-status-empty">
            <strong>모든 제품의 사용 기록을 계산할 수 있습니다.</strong>
            <span>새 제품을 추가하면 필요한 기록이 이곳에 표시됩니다.</span>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="primary-button" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  );
}

function learningMessage(product: InventoryProduct, useSampleCount: number) {
  if (product.tracking_mode === "cycle") {
    return "제품을 다 쓴 기록 1회 필요";
  }

  const remaining = Math.max(0, 2 - useSampleCount);
  return remaining > 0
    ? `서로 다른 날짜의 사용 기록 ${remaining}회 필요`
    : "사용 속도 계산 가능";
}
