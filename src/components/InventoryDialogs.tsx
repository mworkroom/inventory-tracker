import type { InventoryWorkspaceController } from "../hooks/useInventoryWorkspaceController";
import { ActionDialog } from "./ActionDialog";
import { ActiveUsageDialog } from "./ActiveUsageDialog";
import { ArchivedProductsDialog } from "./ArchivedProductsDialog";
import { EventAmountDialog } from "./EventAmountDialog";
import { ProductEditor } from "./ProductEditor";
import { PurchaseDialog } from "./PurchaseDialog";
import { UsageCycleDialog } from "./UsageCycleDialog";

interface InventoryDialogsProps {
  controller: InventoryWorkspaceController;
}

export function InventoryDialogs({
  controller
}: InventoryDialogsProps) {
  const { inventory, lifecycle, busy } = controller;

  return (
    <>
      {controller.editorProduct !== undefined ? (
        <ProductEditor
          product={controller.editorProduct}
          stores={inventory.stores}
          busy={busy}
          canDelete={controller.editorCanDelete}
          onClose={() => controller.setEditorProduct(undefined)}
          onSubmit={controller.saveProduct}
          onArchive={
            controller.editorProduct
              ? controller.archiveEditedProduct
              : null
          }
          onDelete={
            controller.editorProduct ? controller.deleteEditedProduct : null
          }
        />
      ) : null}

      {controller.actionState ? (
        <ActionDialog
          product={controller.actionState.product}
          action={controller.actionState.action}
          busy={busy}
          onClose={() => controller.setActionState(null)}
          onSubmit={controller.saveAction}
        />
      ) : null}

      {controller.purchaseState ? (
        <PurchaseDialog
          product={controller.purchaseState.product}
          stores={inventory.stores}
          purchase={controller.purchaseState.purchase}
          mode={controller.purchaseState.mode}
          busy={busy}
          onClose={() => controller.setPurchaseState(null)}
          onSubmitSingle={controller.savePurchase}
          onSubmitBulk={controller.savePurchaseBatch}
          onDelete={
            controller.purchaseState.mode === "edit"
              ? controller.deletePurchase
              : null
          }
        />
      ) : null}

      {controller.activeUsageProduct ? (
        <ActiveUsageDialog
          product={controller.activeUsageProduct}
          busy={busy}
          onClose={() => controller.setActiveUsageProduct(null)}
          onSubmit={controller.saveActiveUsage}
        />
      ) : null}

      {controller.usageCycleState ? (
        <UsageCycleDialog
          product={controller.usageCycleState.product}
          cycle={controller.usageCycleState.cycle}
          busy={busy}
          onClose={() => controller.setUsageCycleState(null)}
          onSubmit={controller.saveUsageCycle}
          onDelete={controller.deleteUsageCycle}
        />
      ) : null}

      {controller.eventCorrectionState ? (
        <EventAmountDialog
          product={controller.eventCorrectionState.product}
          event={controller.eventCorrectionState.event}
          busy={busy}
          onClose={() => controller.setEventCorrectionState(null)}
          onSubmit={controller.saveEventAmount}
        />
      ) : null}

      {controller.archivedOpen ? (
        <ArchivedProductsDialog
          products={lifecycle.archivedProducts}
          stores={inventory.stores}
          loading={lifecycle.loading}
          busy={busy}
          error={lifecycle.error}
          onClose={() => controller.setArchivedOpen(false)}
          onRestore={controller.restoreArchivedProduct}
        />
      ) : null}
    </>
  );
}
