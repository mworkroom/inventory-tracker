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
    "20260724205237_use_seoul_inventory_business_date.sql",
    "20260724212046_correct_latest_inventory_event_amount.sql",
    "20260726020940_add_product_shopping_malls.sql",
    "20260726021227_add_product_store_foreign_key_indexes.sql",
    "20260815042204_add_purchase_planning.sql",
    "20260815144215_replay_inventory_event_corrections.sql",
    "20260815163118_add_product_active_months.sql",
    "20260831130100_add_consumption_and_recurring_sale_foundations.sql",
    "20260831130212_switch_to_observation_model.sql",
    "20260831130834_add_observation_model_foreign_key_indexes.sql"
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
const eventCorrectionSql = await readFile(
  join(
    migrationsDirectory,
    "20260724212046_correct_latest_inventory_event_amount.sql"
  ),
  "utf8"
);
const shoppingMallsSql = await readFile(
  join(
    migrationsDirectory,
    "20260726020940_add_product_shopping_malls.sql"
  ),
  "utf8"
);
const purchasePlanningSql = await readFile(
  join(
    migrationsDirectory,
    "20260815042204_add_purchase_planning.sql"
  ),
  "utf8"
);
const eventReplaySql = await readFile(
  join(
    migrationsDirectory,
  "20260815144215_replay_inventory_event_corrections.sql"
  ),
  "utf8"
);
const activeMonthsSql = await readFile(
  join(
    migrationsDirectory,
    "20260815163118_add_product_active_months.sql"
  ),
  "utf8"
);
const consumptionFoundationsSql = await readFile(
  join(
    migrationsDirectory,
    "20260831130100_add_consumption_and_recurring_sale_foundations.sql"
  ),
  "utf8"
);
const observationModelSql = await readFile(
  join(
    migrationsDirectory,
    "20260831130212_switch_to_observation_model.sql"
  ),
  "utf8"
);
const observationModelIndexesSql = await readFile(
  join(
    migrationsDirectory,
    "20260831130834_add_observation_model_foreign_key_indexes.sql"
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
assert.match(
  eventCorrectionSql,
  /create function public\.correct_latest_inventory_event_amount\(/,
  "마지막 재고 기록 수량 정정 RPC가 없습니다."
);
assert.match(
  eventCorrectionSql,
  /security definer[\s\S]*?set search_path = ''/,
  "재고 기록 수량 정정 RPC의 권한 경계가 안전하지 않습니다."
);
assert.match(
  eventCorrectionSql,
  /private\.is_workspace_member\(v_product\.workspace_id\)/,
  "재고 기록 수량 정정 RPC에 workspace 멤버 검사가 없습니다."
);
assert.match(
  eventCorrectionSql,
  /later\.created_at > v_event\.created_at/,
  "마지막 재고 기록만 수정하도록 제한하지 않았습니다."
);
assert.match(
  eventCorrectionSql,
  /v_product\.current_quantity <> v_event\.quantity_after/,
  "현재 재고와 원장의 일치 여부를 확인하지 않습니다."
);
assert.match(
  eventCorrectionSql,
  /revoke all on function public\.correct_latest_inventory_event_amount\(uuid, numeric\)[\s\S]*?grant execute on function public\.correct_latest_inventory_event_amount\(uuid, numeric\)[\s\S]*?to authenticated;/,
  "재고 기록 수량 정정 RPC의 실행 권한이 올바르지 않습니다."
);
assert.match(
  shoppingMallsSql,
  /create table public\.inventory_product_stores/,
  "제품과 복수 쇼핑몰을 연결하는 테이블이 없습니다."
);
assert.match(
  shoppingMallsSql,
  /alter table public\.inventory_product_stores enable row level security/,
  "제품 쇼핑몰 연결 테이블에 RLS가 활성화되지 않았습니다."
);
assert.doesNotMatch(
  shoppingMallsSql,
  /grant [^;]*\b(?:insert|update|delete)\b[^;]* on table public\.inventory_product_stores/i,
  "제품 쇼핑몰 연결을 브라우저가 직접 변경할 수 있습니다."
);

for (const functionName of [
  "create_inventory_product_with_stores",
  "update_inventory_product_with_stores"
]) {
  const start = shoppingMallsSql.indexOf(`create function public.${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 함수가 없습니다.`);
  const bodyEnd = shoppingMallsSql.indexOf("\n$$;", start);
  assert.notEqual(bodyEnd, -1, `${functionName} 함수 본문 끝을 찾지 못했습니다.`);
  const definition = shoppingMallsSql.slice(start, bodyEnd);
  assert.match(
    definition,
    /security definer/,
    `${functionName} 함수가 보호된 테이블에 원자적으로 쓰도록 구성되지 않았습니다.`
  );
  assert.match(
    definition,
    /private\.(?:is_workspace_member|replace_inventory_product_stores)/,
    `${functionName} 함수에 workspace 또는 쇼핑몰 연결 검증이 없습니다.`
  );
}

assert.match(
  purchasePlanningSql,
  /add column next_sale_on date[\s\S]*?add column purchase_coverage_months integer[\s\S]*?add column purchase_safety_quantity integer not null default 0/,
  "세일 구매 계획에 필요한 열이 없습니다."
);

assert.match(
  activeMonthsSql,
  /add column active_months integer\[\]/,
  "계절 제품의 사용 월을 저장하는 열이 없습니다."
);
assert.match(
  activeMonthsSql,
  /inventory_products_active_months_valid[\s\S]*?cardinality\(active_months\) between 1 and 11[\s\S]*?active_months <@ array\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\]/,
  "사용 월 범위를 제한하는 데이터베이스 제약이 없습니다."
);
assert.match(
  activeMonthsSql,
  /create function public\.create_inventory_product_with_stores\([\s\S]*?p_active_months integer\[\][\s\S]*?set active_months = v_active_months/,
  "제품 생성 RPC가 사용 시기를 저장하지 않습니다."
);
assert.match(
  activeMonthsSql,
  /create function public\.update_inventory_product_with_stores\([\s\S]*?p_active_months integer\[\][\s\S]*?set active_months = v_active_months/,
  "제품 수정 RPC가 사용 시기를 저장하지 않습니다."
);
assert.match(
  consumptionFoundationsSql,
  /add column usage_tracking text,[\s\S]*?set usage_tracking = case tracking_mode[\s\S]*?when 'cycle' then 'cycle'[\s\S]*?else 'decrement'[\s\S]*?alter column usage_tracking set not null/,
  "기존 기록 방식을 새 기본 사용 기록 방식으로 안전하게 이관하지 않습니다."
);

assert.doesNotMatch(
  observationModelSql,
  /drop column\s+(?:if exists\s+)?(?:active_months|next_sale_on|purchase_coverage_months|tracking_mode)/i,
  "2단계 전환 migration은 롤백용 기존 열을 아직 제거하면 안 됩니다."
);
assert.match(
  observationModelSql,
  /drop constraint inventory_products_cycle_package_required,[\s\S]*?drop constraint inventory_products_count_package_empty/,
  "재고 단위와 사용 기록 방식을 분리하도록 기존 용량 제약을 해제하지 않습니다."
);
assert.match(
  observationModelSql,
  /create function private\.replace_inventory_product_sale_schedules\([\s\S]*?delete from public\.inventory_product_sale_schedules[\s\S]*?jsonb_to_recordset[\s\S]*?insert into public\.inventory_product_sale_schedules/,
  "정기 세일 일정 전체를 제품 저장 트랜잭션 안에서 교체하지 않습니다."
);
assert.match(
  observationModelSql,
  /product_store\.store_id = v_schedule\.store_id[\s\S]*?store\.is_active = true/,
  "정기 세일 일정의 쇼핑몰이 제품에 연결된 활성 구매처인지 검증하지 않습니다."
);

for (const functionName of [
  "create_inventory_product_with_schedules",
  "update_inventory_product_with_schedules",
  "upsert_inventory_consumption_baseline",
  "delete_inventory_consumption_baseline"
]) {
  const start = observationModelSql.indexOf(`create function public.${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 함수가 없습니다.`);
  const bodyEnd = observationModelSql.indexOf("\n$$;", start);
  assert.notEqual(bodyEnd, -1, `${functionName} 함수 본문 끝을 찾지 못했습니다.`);
  const definition = observationModelSql.slice(start, bodyEnd);
  assert.match(definition, /security definer/, `${functionName}이 보호된 테이블에 원자적으로 쓰지 않습니다.`);
  assert.match(definition, /set search_path = ''/, `${functionName}의 search_path 경계가 안전하지 않습니다.`);
  assert.match(definition, /private\.is_workspace_member/, `${functionName}에 workspace 구성원 검사가 없습니다.`);
}

assert.match(
  observationModelSql,
  /p_usage_tracking is distinct from v_product\.usage_tracking[\s\S]*?active_opened_on is not null[\s\S]*?사용 중인 제품을 다 쓴 뒤/,
  "진행 중인 개봉 주기가 있을 때 사용 기록 방식 변경을 막지 않습니다."
);
assert.match(
  observationModelSql,
  /p_started_on > v_today or p_ended_on > v_today[\s\S]*?회상 소비 기준에는 오늘 또는 과거 날짜만/,
  "회상 소비 기준에 미래 날짜가 들어가는 것을 막지 않습니다."
);
assert.match(
  observationModelSql,
  /active_months,[\s\S]*?next_sale_on,[\s\S]*?purchase_coverage_months,[\s\S]*?null,[\s\S]*?null,[\s\S]*?null,/,
  "새 제품 생성 RPC가 수동 활성 월이나 단일 세일 계획을 다시 저장합니다."
);
assert.doesNotMatch(
  observationModelSql,
  /grant [^;]*\b(?:insert|update|delete)\b[^;]* on table public\.inventory_(?:consumption_baselines|product_sale_schedules)/i,
  "2단계도 새 테이블 직접 쓰기를 열지 않고 검증 RPC만 사용해야 합니다."
);

for (const functionName of [
  "create_inventory_product_with_schedules",
  "update_inventory_product_with_schedules",
  "upsert_inventory_consumption_baseline",
  "delete_inventory_consumption_baseline"
]) {
  assert.match(
    observationModelSql,
    new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;[\\s\\S]*?grant execute on function public\\.${functionName}\\([\\s\\S]*?to authenticated;`),
    `${functionName} 실행 권한이 authenticated 전용으로 제한되지 않았습니다.`
  );
}
assert.match(
  consumptionFoundationsSql,
  /create trigger inventory_products_sync_usage_tracking_from_legacy[\s\S]*?before insert or update of tracking_mode[\s\S]*?sync_inventory_product_usage_tracking_from_legacy/,
  "호환 기간에 기존 tracking_mode 쓰기를 usage_tracking으로 동기화하지 않습니다."
);
assert.doesNotMatch(
  consumptionFoundationsSql,
  /drop column\s+(?:if exists\s+)?(?:active_months|next_sale_on|purchase_coverage_months|tracking_mode)/i,
  "1단계 migration이 아직 사용 중인 기존 열을 제거합니다."
);

for (const tableName of [
  "inventory_consumption_baselines",
  "inventory_product_sale_schedules"
]) {
  assert.match(
    consumptionFoundationsSql,
    new RegExp(`create table public\\.${tableName}`),
    `${tableName} 테이블이 없습니다.`
  );
  assert.match(
    consumptionFoundationsSql,
    new RegExp(`alter table public\\.${tableName} enable row level security`),
    `${tableName} 테이블에 RLS가 활성화되지 않았습니다.`
  );
  assert.match(
    consumptionFoundationsSql,
    new RegExp(`grant select on table public\\.${tableName}\\s*to authenticated;`),
    `${tableName} 테이블의 인증 사용자 조회 권한이 명시되지 않았습니다.`
  );
  assert.doesNotMatch(
    consumptionFoundationsSql,
    new RegExp(
      `grant [^;]*\\b(?:insert|update|delete)\\b[^;]* on table public\\.${tableName}`,
      "i"
    ),
    `${tableName} 테이블을 1단계 UI가 직접 변경할 수 있습니다.`
  );
}

for (const [indexName, tableName, columns] of [
  [
    "inventory_baselines_product_workspace_idx",
    "inventory_consumption_baselines",
    "product_id, workspace_id"
  ],
  [
    "inventory_baselines_created_by_idx",
    "inventory_consumption_baselines",
    "created_by"
  ],
  [
    "inventory_baselines_updated_by_idx",
    "inventory_consumption_baselines",
    "updated_by"
  ],
  [
    "inventory_sale_schedules_product_workspace_idx",
    "inventory_product_sale_schedules",
    "product_id, workspace_id"
  ],
  [
    "inventory_sale_schedules_created_by_idx",
    "inventory_product_sale_schedules",
    "created_by"
  ],
  [
    "inventory_sale_schedules_updated_by_idx",
    "inventory_product_sale_schedules",
    "updated_by"
  ]
]) {
  assert.match(
    observationModelIndexesSql,
    new RegExp(
      `create index ${indexName}\\s+on public\\.${tableName} \\(${columns}\\)`
    ),
    `${tableName}의 ${columns} 외래 키를 보조하는 인덱스가 없습니다.`
  );
}

assert.equal(
  [...observationModelIndexesSql.matchAll(/create index /g)].length,
  6,
  "관찰 모델 FK 보조 인덱스 수가 예상과 다릅니다."
);

assert.match(
  consumptionFoundationsSql,
  /inventory_consumption_baselines_product_unique[\s\S]*?unique \(product_id\)[\s\S]*?inventory_consumption_baselines_dates_valid[\s\S]*?ended_on >= started_on/,
  "제품별 회상 소비 기준 하나와 유효한 관찰 구간을 보장하지 않습니다."
);
assert.match(
  consumptionFoundationsSql,
  /inventory_product_sale_schedules_day_valid[\s\S]*?sale_month = 2 then 29[\s\S]*?sale_month in \(4, 6, 9, 11\) then 30/,
  "정기 세일 일정의 월별 유효 날짜를 제한하지 않습니다."
);
assert.match(
  consumptionFoundationsSql,
  /insert into public\.inventory_product_sale_schedules[\s\S]*?coalesce\(product\.preferred_store_id, first_store\.store_id\)[\s\S]*?'기존 세일 일정'[\s\S]*?extract\(month from product\.next_sale_on\)[\s\S]*?where product\.next_sale_on is not null/,
  "기존 다음 세일 날짜를 반복 일정 기반으로 복사하지 않습니다."
);
assert.match(
  purchasePlanningSql,
  /inventory_products_purchase_plan_pair[\s\S]*?next_sale_on is null[\s\S]*?purchase_coverage_months is null/,
  "세일 날짜와 구매 기간의 입력 쌍 제약이 없습니다."
);
assert.match(
  purchasePlanningSql,
  /create function public\.create_inventory_product_with_stores\([\s\S]*?p_next_sale_on date[\s\S]*?p_purchase_coverage_months integer[\s\S]*?p_purchase_safety_quantity integer/,
  "제품 생성 RPC가 세일 구매 계획을 저장하지 않습니다."
);
assert.match(
  purchasePlanningSql,
  /create function public\.update_inventory_product_with_stores\([\s\S]*?next_sale_on = p_next_sale_on[\s\S]*?purchase_coverage_months = p_purchase_coverage_months/,
  "제품 수정 RPC가 세일 구매 계획을 저장하지 않습니다."
);

assert.match(
  eventReplaySql,
  /create function private\.replay_inventory_product_stock\([\s\S]*?order by created_at, id[\s\S]*?update public\.inventory_products[\s\S]*?current_quantity = v_running_quantity/,
  "재고 기록 재계산 함수가 원장을 생성 순서대로 다시 연결하지 않습니다."
);
assert.match(
  eventReplaySql,
  /when 'adjustment' then[\s\S]*?v_next_quantity := v_event\.quantity_after/,
  "재고 정정 기록의 실제 수량 기준점을 보존하지 않습니다."
);
assert.match(
  eventReplaySql,
  /create function public\.update_inventory_event_amount\([\s\S]*?private\.is_workspace_member[\s\S]*?private\.replay_inventory_product_stock/,
  "과거 입고·사용 기록 수정 RPC가 권한 확인 후 원장을 재계산하지 않습니다."
);
assert.match(
  eventReplaySql,
  /create function public\.delete_inventory_event\([\s\S]*?event_type not in \('intake', 'use'\)[\s\S]*?private\.replay_inventory_product_stock/,
  "입고·사용 기록 삭제 RPC가 허용 범위를 제한하고 원장을 재계산하지 않습니다."
);
assert.match(
  eventReplaySql,
  /revoke all on function public\.update_inventory_event_amount\(uuid, numeric\)[\s\S]*?grant execute on function public\.update_inventory_event_amount\(uuid, numeric\)[\s\S]*?to authenticated;[\s\S]*?revoke all on function public\.delete_inventory_event\(uuid\)[\s\S]*?grant execute on function public\.delete_inventory_event\(uuid\)[\s\S]*?to authenticated;/,
  "재고 기록 수정·삭제 RPC의 실행 권한이 올바르지 않습니다."
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
