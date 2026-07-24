import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

assert.deepEqual(
  migrationNames,
  [
    "20260722025024_safe_record_corrections.sql",
    "20260722031757_add_product_categories.sql",
    "20260722032845_add_cosmetics_category.sql",
    "20260724194457_rebuild_inventory_tracker_v2.sql",
    "20260724194709_add_inventory_foreign_key_indexes.sql",
    "20260724203523_separate_product_creation_from_inventory_events.sql",
    "20260724205237_use_seoul_inventory_business_date.sql"
  ],
  "적용된 migration 이력과 v2 migration 목록이 다릅니다."
);

const sql = await readFile(
  join(migrationsDirectory, "20260724194457_rebuild_inventory_tracker_v2.sql"),
  "utf8"
);
const productCreationSql = await readFile(
  join(
    migrationsDirectory,
    "20260724203523_separate_product_creation_from_inventory_events.sql"
  ),
  "utf8"
);
const businessDateSql = await readFile(
  join(
    migrationsDirectory,
    "20260724205237_use_seoul_inventory_business_date.sql"
  ),
  "utf8"
);

assert.doesNotMatch(
  sql,
  /\b(?:remainder|active_remaining_quantity|active_remaining_updated_on)\b/i,
  "새 스키마에 수동 잔량 모델이 남아 있습니다."
);
assert.match(
  sql,
  /event_type in \('intake', 'use', 'open', 'finish', 'adjustment'\)/,
  "이벤트 종류가 단순화된 계약과 다릅니다."
);
assert.match(
  sql,
  /grant update \(\s*name,[\s\S]*?updated_by\s*\) on table public\.inventory_products\s*to authenticated;/,
  "제품 설정에 필요한 열 단위 UPDATE 권한이 없습니다."
);
assert.doesNotMatch(
  sql,
  /grant (?:select,\s*)?(?:insert,\s*)?update(?:,\s*delete)? on table public\.inventory_products/i,
  "제품 전체 UPDATE 권한을 열면 수량 원장을 우회할 수 있습니다."
);
assert.doesNotMatch(
  sql,
  /grant [^;]*\binsert\b[^;]* on table public\.inventory_(?:events|usage_cycles)/i,
  "이벤트 또는 사용 주기를 브라우저가 직접 생성할 수 있습니다."
);
assert.doesNotMatch(
  productCreationSql,
  /\bp_(?:initial_quantity|occurred_on)\b/,
  "제품 기준 정보 생성 RPC에 최초 재고나 기록 날짜가 남아 있습니다."
);
assert.doesNotMatch(
  productCreationSql,
  /insert into public\.inventory_events/i,
  "제품 생성 시 재고 이벤트를 함께 만들면 안 됩니다."
);
assert.match(
  productCreationSql,
  /current_quantity,[\s\S]*?stock_initialized,[\s\S]*?\n\s*0,\s*\n\s*false,/,
  "새 제품은 재고 미설정 상태로 생성되어야 합니다."
);
assert.doesNotMatch(
  businessDateSql,
  /\bcurrent_date\b/i,
  "운영 기록 날짜를 UTC 데이터베이스 날짜와 직접 비교하고 있습니다."
);
assert.match(
  businessDateSql,
  /p_occurred_on date default \(\(now\(\) at time zone 'Asia\/Seoul'\)::date\)/,
  "재고 기록 기본 날짜가 한국 날짜 기준이 아닙니다."
);
assert.match(
  businessDateSql,
  /alter column occurred_on[\s\S]*?time zone 'Asia\/Seoul'/,
  "재고 이벤트 기본 날짜가 한국 날짜 기준이 아닙니다."
);
assert.match(
  businessDateSql,
  /new\.finished_on > \(now\(\) at time zone 'Asia\/Seoul'\)::date/,
  "과거 사용 주기 완료일 검사가 한국 날짜 기준이 아닙니다."
);
assert.match(
  businessDateSql,
  /p_opened_on > \(now\(\) at time zone 'Asia\/Seoul'\)::date/,
  "현재 개봉일 검사가 한국 날짜 기준이 아닙니다."
);

for (const functionName of [
  "create_inventory_product",
  "record_inventory_action",
  "update_active_usage",
  "set_inventory_product_archived",
  "delete_unused_inventory_product"
]) {
  const start = sql.indexOf(`create function public.${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 함수가 없습니다.`);
  const bodyEnd = sql.indexOf("\n$$;", start);
  assert.notEqual(bodyEnd, -1, `${functionName} 함수 본문 끝을 찾지 못했습니다.`);
  const definition = sql.slice(start, bodyEnd);
  assert.match(
    definition,
    /security definer/,
    `${functionName}이 보호된 테이블에 원자적으로 쓰도록 구성되지 않았습니다.`
  );
  assert.match(
    definition,
    /private\.is_workspace_member/,
    `${functionName}에 workspace 멤버 검사가 없습니다.`
  );
}

console.log("Inventory Tracker v2 schema contract verified.");
