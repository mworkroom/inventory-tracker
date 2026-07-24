-- CI-only prerequisite for reconstructing Inventory Tracker on a blank local
-- Supabase database. Production already owns these shared workspace objects.

create schema if not exists private;

create table public.workspaces (
  id uuid primary key,
  name text not null
);

create table public.workspace_members (
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  primary key (workspace_id, user_id)
);

create function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = auth.uid()
  );
$$;

revoke all on function private.is_workspace_member(uuid)
from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid)
to authenticated;
