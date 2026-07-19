-- Reuse the two household accounts already registered in workspace ...0001.
insert into public.workspace_members (workspace_id, user_id, role)
select
  '00000000-0000-0000-0000-000000000002'::uuid,
  user_id,
  role
from public.workspace_members
where workspace_id = '00000000-0000-0000-0000-000000000001'::uuid
on conflict (workspace_id, user_id)
do update set role = excluded.role;
