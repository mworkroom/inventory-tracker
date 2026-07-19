import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Inventory Tracker failed to render", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="auth-shell">
        <section className="auth-card" aria-live="assertive">
          <span className="auth-eyebrow">INVENTORY</span>
          <h1>앱을 표시하지 못했습니다</h1>
          <p>
            흰 화면 대신 실제 오류를 표시하고 있습니다. 아래 내용을 확인한 뒤
            새로고침해주세요.
          </p>
          <div className="auth-message">
            {this.state.error.message || "알 수 없는 화면 오류가 발생했습니다."}
          </div>
          <div className="auth-actions">
            <button
              type="button"
              className="auth-primary-button"
              onClick={() => window.location.reload()}
            >
              다시 불러오기
            </button>
          </div>
        </section>
      </main>
    );
  }
}
