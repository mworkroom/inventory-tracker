import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_ID } from "../config";
import { supabase, supabaseConfigError } from "../lib/supabase";

export type AuthStatus =
  | "config-error"
  | "loading"
  | "signed-out"
  | "checking-access"
  | "authorized"
  | "unauthorized"
  | "error";

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  role: "admin" | "member" | null;
  message: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [accessStatus, setAccessStatus] = useState<
    "idle" | "checking" | "authorized" | "unauthorized" | "error"
  >("idle");
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  const [message, setMessage] = useState<string | null>(supabaseConfigError);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setSessionReady(true);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      setSession(data.session);
      setSessionReady(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionReady(true);
      setAccessStatus(nextSession ? "checking" : "idle");
      setRole(null);
      setMessage(null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !sessionReady) return;
    if (!session) {
      setAccessStatus("idle");
      setRole(null);
      return;
    }

    let active = true;
    setAccessStatus("checking");
    setMessage(null);

    void supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setMessage(`워크스페이스 권한을 확인하지 못했습니다. ${error.message}`);
          setAccessStatus("error");
          setRole(null);
          return;
        }

        const nextRole = data?.role === "admin" || data?.role === "member" ? data.role : null;
        setRole(nextRole);
        setAccessStatus(nextRole ? "authorized" : "unauthorized");
      });

    return () => {
      active = false;
    };
  }, [retryToken, session, sessionReady]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    setMessage(null);
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.href).toString();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) setMessage(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage(error.message);
      return;
    }
    setSession(null);
    setRole(null);
    setAccessStatus("idle");
  }, []);

  const retry = useCallback(() => {
    setRetryToken((value) => value + 1);
  }, []);

  return {
    status: getStatus({
      configError: supabaseConfigError,
      sessionReady,
      session,
      accessStatus,
      message
    }),
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
    role,
    message,
    signInWithGoogle,
    signOut,
    retry
  };
}

function getStatus({
  configError,
  sessionReady,
  session,
  accessStatus,
  message
}: {
  configError: string | null;
  sessionReady: boolean;
  session: Session | null;
  accessStatus: "idle" | "checking" | "authorized" | "unauthorized" | "error";
  message: string | null;
}): AuthStatus {
  if (configError) return "config-error";
  if (!sessionReady) return "loading";
  if (!session) return message ? "error" : "signed-out";
  if (accessStatus === "authorized") return "authorized";
  if (accessStatus === "unauthorized") return "unauthorized";
  if (accessStatus === "error") return "error";
  return "checking-access";
}
