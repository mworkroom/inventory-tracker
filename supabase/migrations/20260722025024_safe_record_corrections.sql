-- 재고 수량 원장은 그대로 보존하면서, 사용 인원과 사용 주기처럼
-- 예측에 필요한 설명 정보는 앱에서 안전하게 정정할 수 있게 합니다.

begin;

drop policy if exists inventory_events_update_member on public.inventory_events;

create policy inventory_events_update_member
on public.inventory_events
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

grant update (occurred_on, consumer_count)
on table public.inventory_events
to authenticated;

create or replace function public.update_active_usage(
  p_product_id uuid,
  p_opened_on date,
  p_consumer_count integer
)
returns public.inventory_products
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_product public.inventory_products%rowtype;
  v_open_event_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  if p_opened_on is null or p_opened_on > current_date then
    raise exception using errcode = '22023', message = '개봉일은 오늘 또는 과거 날짜여야 합니다.';
  end if;

  if coalesce(p_consumer_count, 0) < 1 then
    raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  select *
  into v_product
  from public.inventory_products
  where id = p_product_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = '수정할 제품을 찾을 수 없거나 권한이 없습니다.';
  end if;

  if v_product.tracking_mode <> 'cycle' or v_product.active_opened_on is null then
    raise exception using errcode = '22023', message = '현재 사용 중인 개봉·소진 제품만 수정할 수 있습니다.';
  end if;

  select id
  into v_open_event_id
  from public.inventory_events
  where workspace_id = v_product.workspace_id
    and product_id = v_product.id
    and event_type = 'open'
    and occurred_on = v_product.active_opened_on
  order by created_at desc
  limit 1
  for update;

  if v_open_event_id is null then
    raise exception using errcode = 'P0001', message = '연결된 개봉 기록을 찾지 못해 수정하지 않았습니다.';
  end if;

  update public.inventory_products
  set active_opened_on = p_opened_on,
      active_consumer_count = p_consumer_count,
      current_consumer_count = p_consumer_count,
      updated_by = auth.uid()
  where id = v_product.id
  returning * into v_product;

  update public.inventory_events
  set occurred_on = p_opened_on,
      consumer_count = p_consumer_count
  where id = v_open_event_id;

  return v_product;
end;
$$;

revoke all on function public.update_active_usage(uuid, date, integer)
from public, anon;

grant execute on function public.update_active_usage(uuid, date, integer)
to authenticated;

create or replace function private.set_usage_cycle_duration()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.opened_on is null or new.finished_on is null then
    raise exception using errcode = '22023', message = '개봉일과 다 쓴 날을 모두 입력해주세요.';
  end if;

  if new.finished_on < new.opened_on then
    raise exception using errcode = '22023', message = '다 쓴 날은 개봉일보다 빠를 수 없습니다.';
  end if;

  if new.finished_on > current_date then
    raise exception using errcode = '22023', message = '미래 날짜는 사용 주기로 저장할 수 없습니다.';
  end if;

  if coalesce(new.consumer_count, 0) < 1 then
    raise exception using errcode = '22023', message = '사용 인원은 1명 이상이어야 합니다.';
  end if;

  new.duration_days := (new.finished_on - new.opened_on) + 1;
  return new;
end;
$$;

drop trigger if exists inventory_usage_cycles_set_duration
on public.inventory_usage_cycles;

create trigger inventory_usage_cycles_set_duration
before insert or update of opened_on, finished_on, consumer_count
on public.inventory_usage_cycles
for each row
execute function private.set_usage_cycle_duration();

drop policy if exists inventory_usage_cycles_update_member
on public.inventory_usage_cycles;

create policy inventory_usage_cycles_update_member
on public.inventory_usage_cycles
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

drop policy if exists inventory_usage_cycles_delete_member
on public.inventory_usage_cycles;

create policy inventory_usage_cycles_delete_member
on public.inventory_usage_cycles
for delete
to authenticated
using ((select private.is_workspace_member(workspace_id)));

grant update (opened_on, finished_on, consumer_count), delete
on table public.inventory_usage_cycles
to authenticated;

comment on function public.update_active_usage(uuid, date, integer) is
  '현재 사용 중 제품과 연결된 개봉 기록의 개봉일·사용 인원을 한 트랜잭션에서 정정합니다.';

comment on trigger inventory_usage_cycles_set_duration
on public.inventory_usage_cycles is
  '사용 주기 날짜가 바뀌면 기간을 포함 일수로 다시 계산합니다.';

notify pgrst, 'reload schema';

commit;
