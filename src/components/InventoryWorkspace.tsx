import type { AuthorizedContext } from "./AuthGate";
import { useInventoryViewModel } from "../hooks/useInventoryViewModel";
import { useInventoryWorkspaceController } from "../hooks/useInventoryWorkspaceController";
import { FilterTabs } from "./FilterTabs";
import { Header } from "./Header";
import { InventoryDialogs } from "./InventoryDialogs";
import { InventoryList } from "./InventoryList";
import { SearchBar } from "./SearchBar";

export function InventoryWorkspace({
  userId,
  email,
  signOut
}: AuthorizedContext) {
  const controller = useInventoryWorkspaceController(userId);
  const view = useInventoryViewModel({
    inventory: controller.inventory,
    query: controller.query,
    filter: controller.filter,
    viewMode: controller.viewMode
  });

  return (
    <main className="app-shell">
      <Header
        email={email}
        busy={controller.busy}
        archivedCount={controller.lifecycle.archivedProducts.length}
        onAdd={() => controller.setEditorProduct(null)}
        onOpenLearningStatus={() => controller.setLearningStatusOpen(true)}
        onOpenArchived={controller.openArchived}
        onRefresh={controller.refreshAll}
        onBackup={controller.backup}
        onSignOut={signOut}
      />

      <section className="inventory-controls" aria-label="재고 검색과 필터">
        <SearchBar
          value={controller.query}
          onChange={controller.setQuery}
        />
        <FilterTabs
          value={controller.filter}
          counts={view.counts}
          onChange={controller.setFilter}
        />
      </section>

      {controller.inventory.error ? (
        <div className="error-banner" role="alert">
          <span>{controller.inventory.error}</span>
          <button
            type="button"
            onClick={() => void controller.inventory.refresh()}
          >
            다시 불러오기
          </button>
        </div>
      ) : null}

      <InventoryList controller={controller} view={view} />
      <InventoryDialogs controller={controller} view={view} />

      {controller.toast ? (
        <div className="toast" role="status">
          {controller.toast}
        </div>
      ) : null}
    </main>
  );
}
