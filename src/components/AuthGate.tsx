import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { LoginScreen } from "./LoginScreen";

export interface AuthorizedContext {
  userId: string;
  email: string | null;
  role: "admin" | "member";
  signOut: () => Promise<void>;
}

interface AuthGateProps {
  children: (context: AuthorizedContext) => ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const auth = useAuth();

  if (
    auth.status === "authorized" &&
    auth.userId &&
    auth.role
  ) {
    return (
      <>
        {children({
          userId: auth.userId,
          email: auth.email,
          role: auth.role,
          signOut: auth.signOut
        })}
      </>
    );
  }

  return (
    <LoginScreen
      status={auth.status}
      email={auth.email}
      message={auth.message}
      onSignIn={auth.signInWithGoogle}
      onSignOut={auth.signOut}
      onRetry={auth.retry}
    />
  );
}
