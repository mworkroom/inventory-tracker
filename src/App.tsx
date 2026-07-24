import { AuthGate } from "./components/AuthGate";
import { InventoryWorkspace } from "./components/InventoryWorkspace";

export default function App() {
  return (
    <AuthGate>
      {(context) => <InventoryWorkspace {...context} />}
    </AuthGate>
  );
}
