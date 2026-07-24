import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const targetRoot = resolve(
  process.argv[2] || join(process.cwd(), ".supabase-test-project")
);
const targetName = basename(targetRoot);

if (targetName !== ".supabase-test-project") {
  throw new Error(
    "DB test target must be the dedicated .supabase-test-project directory."
  );
}

const sourceRoot = process.cwd();
const sourceMigrations = join(sourceRoot, "supabase", "migrations");
const sourceTests = join(sourceRoot, "supabase", "tests");
const fixture = join(
  sourceRoot,
  "supabase",
  "test-support",
  "shared_workspace_fixture.sql"
);
const targetSupabase = join(targetRoot, "supabase");
const targetConfig = join(targetSupabase, "config.toml");
const targetMigrations = join(targetSupabase, "migrations");
const targetTests = join(targetSupabase, "tests");
const baseline = "20260724194457_rebuild_inventory_tracker_v2.sql";

await access(targetConfig);

const migrationNames = (await readdir(sourceMigrations))
  .filter((name) => name.endsWith(".sql") && name >= baseline)
  .sort();

if (migrationNames[0] !== baseline) {
  throw new Error("Inventory Tracker v2 baseline migration was not found.");
}

await rm(targetMigrations, { recursive: true, force: true });
await rm(targetTests, { recursive: true, force: true });
await mkdir(targetMigrations, { recursive: true });

await cp(
  fixture,
  join(targetMigrations, "20260724194456_shared_workspace_test_fixture.sql")
);

for (const migrationName of migrationNames) {
  await cp(
    join(sourceMigrations, migrationName),
    join(targetMigrations, migrationName)
  );
}

await cp(sourceTests, targetTests, { recursive: true });

console.log(
  `Prepared blank DB test project with ${migrationNames.length} production migrations.`
);
