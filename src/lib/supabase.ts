import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

export const supabaseConfigError = getConfigError(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

export const supabase = supabaseConfigError
  ? null
  : createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    });

function getConfigError(url: string, key: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return "Supabase URL은 HTTPS 주소여야 합니다.";
    }
  } catch {
    return "Supabase URL 형식이 올바르지 않습니다.";
  }

  if (!key) return "Supabase publishable key가 없습니다.";
  if (key.startsWith("sb_secret_") || getLegacyJwtRole(key) === "service_role") {
    return "브라우저에는 publishable key만 사용할 수 있습니다.";
  }

  return null;
}

function getLegacyJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}
