drop policy if exists inventory_events_select_member on public.inventory_events;

create policy inventory_events_select_member
on public.inventory_events
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists inventory_events_insert_member on public.inventory_events;

create policy inventory_events_insert_member
on public.inventory_events
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
);

drop policy if exists inventory_usage_cycles_select_member on public.inventory_usage_cycles;

create policy inventory_usage_cycles_select_member
on public.inventory_usage_cycles
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists inventory_usage_cycles_insert_member on public.inventory_usage_cycles;

create policy inventory_usage_cycles_insert_member
on public.inventory_usage_cycles
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
);

revoke all on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date
) from public, anon;

grant execute on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date
) to authenticated;

revoke all on function public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
) from public, anon;

grant execute on function public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
) to authenticated;

comment on table public.inventory_products is
  'Inventory Tracker products and current stock snapshot.';

comment on table public.inventory_events is
  'Append-only stock, opening, and depletion event history.';

comment on table public.inventory_usage_cycles is
  'Completed open-to-finish cycles used to learn purchase timing.';

comment on function public.create_inventory_product(
  uuid, text, text, text, numeric, numeric, integer, numeric, text, integer, text, date
) is 'Creates an inventory product and its initial stock baseline event.';

comment on function public.record_inventory_action(
  uuid, text, numeric, numeric, date, integer, text
) is 'Atomically records intake, use, open, finish, or stock correction.';
