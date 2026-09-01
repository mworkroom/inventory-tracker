# Supabase schema

`migrations/` is the only active migration chain. Already-applied migrations
remain immutable so their versions continue to match Supabase migration
history. The latest Inventory Tracker v2 migration rebuilds only the five
`inventory_*` tables and their functions, policies, triggers, indexes, and seed
stores.

Later migrations extend that baseline without rewriting it. In particular,
`20260726020940_add_product_shopping_malls.sql` adds the protected
`inventory_product_stores` relation and atomic product RPCs used for selecting
multiple shopping malls. Its follow-up migration adds the covering indexes
required by the relation's workspace and audit foreign keys.

The observation-first consumption rollout is recorded in three production
migrations. `20260831130100_add_consumption_and_recurring_sale_foundations.sql`
adds the independent usage-tracking field, recalled baseline table, and
recurring sale schedules while retaining the legacy columns. The Stage 2
`20260831130212_switch_to_observation_model.sql` migration adds the guarded
product, schedule, and baseline RPCs used by the new frontend. The follow-up
`20260831130834_add_observation_model_foreign_key_indexes.sql` covers the new
composite product and audit-user foreign keys reported by the production
Advisor.

The baseline is intentionally destructive to Inventory Tracker data. Do not
apply it to production until an inventory-only backup has been captured and
the matching frontend release is ready. It does not delete shared Auth,
`workspaces`, `workspace_members`, or data owned by other apps.

The dated SQL files directly in this directory are historical working scripts,
not migrations. They describe the earlier incremental path and must not be run
after the v2 baseline.

## Automated database contract

`.github/workflows/database-tests.yml` creates an isolated local Supabase
project on GitHub Actions. It adds only the shared workspace prerequisite from
`test-support/`, replays the v2 baseline and every later production migration
onto a blank database, resets it once more, and runs the pgTAP tests in
`tests/database/`.

The test fixture is never applied to production. The pre-v2 migration files
remain in `migrations/` only to preserve the already-applied hosted migration
history; the isolated reconstruction begins at the v2 baseline.
