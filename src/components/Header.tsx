import { useState } from "react";
import { RefreshIcon, SettingsIcon } from "./Icons";

interface HeaderProps {
  email: string | null;
  busy: boolean;
  onAdd: () => void;
  onRefresh: () => void;
  onBackup: () => void;
  onSignOut: () => Promise<void>;
}

export function Header({
  email,
  busy,
  onAdd,
  onRefresh,
  onBackup,
  onSignOut
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  function runAndClose(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <header className="topbar">
      <h1>우리집 재고</h1>
      <div className="topbar-actions">
        <button type="button" className="topbar-button" disabled={busy} onClick={onAdd}>
          <span aria-hidden="true">＋</span>
          <span className="topbar-button-long">제품 추가</span>
          <span className="topbar-button-short">추가</span>
        </button>

        <details
          className="topbar-menu"
          open={menuOpen}
          onToggle={(event) => setMenuOpen(event.currentTarget.open)}
        >
          <summary aria-label="설정 메뉴">
            <SettingsIcon />
          </summary>
          <div className="topbar-menu-panel">
            <p className="topbar-menu-account">
              <span>로그인한 아이디</span>
              <strong>{email || "확인할 수 없음"}</strong>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => runAndClose(onRefresh)}
            >
              <RefreshIcon />
              새로고침
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => runAndClose(onBackup)}
            >
              JSON 백업 저장
            </button>
            <button
              type="button"
              onClick={() => runAndClose(() => void onSignOut())}
            >
              로그아웃
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
