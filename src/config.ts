export const WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";

// Supabase publishable keys are designed for browser use. RLS protects the data.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() ||
  "https://ddlwainwollvpaeccpty.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  "sb_publishable_PJkTB8OFlF2_fgTqSkrKlw_rRk5VUVN";
