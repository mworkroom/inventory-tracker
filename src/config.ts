export const WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";

function requireEnv(name: string, value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  }

  return normalized;
}

// Values are injected at build time from local .env or GitHub Variables.
export const SUPABASE_URL = requireEnv(
  "VITE_SUPABASE_URL",
  import.meta.env.VITE_SUPABASE_URL
);

export const SUPABASE_PUBLISHABLE_KEY = requireEnv(
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);
