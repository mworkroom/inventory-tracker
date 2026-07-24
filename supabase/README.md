# Supabase schema

`migrations/` is the only active migration chain. Already-applied migrations
remain immutable so their versions continue to match Supabase migration
history. The latest Inventory Tracker v2 migration rebuilds only the five
`inventory_*` tables and their functions, policies, triggers, indexes, and seed
stores.

The baseline is intentionally destructive to Inventory Tracker data. Do not
apply it to production until an inventory-only backup has been captured and
the matching frontend release is ready. It does not delete shared Auth,
`workspaces`, `workspace_members`, or data owned by other apps.

The dated SQL files directly in this directory are historical working scripts,
not migrations. They describe the earlier incremental path and must not be run
after the v2 baseline.
