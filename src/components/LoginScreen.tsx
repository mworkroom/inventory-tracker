import type { AuthStatus } from "../hooks/useAuth";

interface LoginScreenProps {
  status: AuthStatus;
  email: string | null;
  message: string | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRetry: () => void;
}

export function LoginScreen({
  status,
  email,
  message,
  onSignIn,
  onSignOut,
  onRetry
}: LoginScreenProps) {
  const content = getContent(status);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <span className="auth-eyebrow">INVENTORY</span>
        <h1>{content.title}</h1>
        <p>{content.description}</p>

        {email ? <div className="auth-account">로그인 계정 · {email}</div> : null}
        {message ? <div className="auth-message">{message}</div> : null}

        <div className="auth-actions">
          {status === "signed-out" || (status === "error" && !email) ? (
            <button
              type="button"
              className="auth-primary-button"
              onClick={() => void onSignIn()}
            >
              Google로 로그인
            </button>
          ) : null}

          {status === "unauthorized" || (status === "error" && email) ? (
            <button
              type="button"
              className="auth-secondary-button"
              onClick={() => void onSignOut()}
            >
              로그아웃
            </button>
          ) : null}

          {status === "error" && email ? (
            <button type="button" className="auth-primary-button" onClick={onRetry}>
              권한 다시 확인
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function getContent(status: AuthStatus) {
  switch (status) {
    case "config-error":
      return {
        title: "Supabase 설정이 필요합니다",
        description: "연결 정보를 확인한 뒤 앱을 다시 열어주세요."
      };
    case "loading":
      return {
        title: "로그인 상태를 확인하고 있습니다",
        description: "재고 기록을 불러올 준비를 하고 있어요."
      };
    case "checking-access":
    case "authorized":
      return {
        title: "사용 권한을 확인하고 있습니다",
        description: "잠시만 기다려주세요."
      };
    case "unauthorized":
      return {
        title: "사용 권한이 없는 계정입니다",
        description: "허용된 Google 계정으로 다시 로그인해주세요."
      };
    case "error":
      return {
        title: "로그인을 완료하지 못했습니다",
        description: "아래 오류를 확인한 뒤 다시 시도해주세요."
      };
    case "signed-out":
    default:
      return {
        title: "우리집 재고",
        description: "소파에서 냉장고와 화장품 창고 안을 바로 확인하세요."
      };
  }
}
