# Inventory Tracker — 이전 대화 요구사항 반영 분석

- 대상 저장소: `mworkroom/inventory-tracker`
- 분석 기준 브랜치: `main`
- 분석 기준 최신 커밋: `e96d28c5426cd200a79ceba25f9b9eeca5258468`
- 기준 대화: Consumables DB / Purchase Log DB / Inventory Batch DB, 사용 주기 학습, 세일 구매, 시즌성 제품, 연간 소비량 관찰에 관한 현재 채팅
- 작성일: 2026-07-21

---

## 1. 결론

현재 앱은 대화에서 이야기한 전체 시스템 가운데 **“현재 재고를 기록하고 실제 사용 기록으로 소진 시점을 학습하여 구매 필요를 알려주는 기능”은 상당히 잘 구현**되어 있다.

반면 다음 영역은 아직 거의 구현되지 않았다.

1. 구매처·가격·할인 정보를 축적하는 **Purchase Log**
2. 제품별 개별 재고 단위를 관리하는 진짜 의미의 **Inventory Batch**
3. 허블룸 겨울크림처럼 **특정 계절에 필요한 총량을 계산하는 시즌 계획**
4. 더랩 토너처럼 **세일 가격대와 긴급 구매 가격을 비교하는 구매 전략**
5. 구연산을 1년에 몇 kg 쓰는지 보여주는 **연간 소비 통계**

대략적인 반영도를 나누면 다음과 같다.

| 영역 | 반영도 | 판단 |
|---|---:|---|
| 기본 재고 등록·증감 | 90% | 잘 구현됨 |
| 개봉→소진 주기 학습 | 90% | 잘 구현됨 |
| 예상 소진일·구매 경고 | 75% | 핵심은 구현됨 |
| Consumables DB 제품 마스터 | 45% | 재고 관련 필드만 있음 |
| Purchase Log DB | 5% | 입고 이벤트만 있고 구매 정보는 없음 |
| Inventory Batch DB | 20% | 개별 batch가 아니라 완료된 사용 주기만 있음 |
| 계절성·연간 구매량 계획 | 10% | 거의 없음 |
| 가격·세일 전략 | 0% | 구현되지 않음 |
| 연간 소비량 통계 | 15% | 계산 가능한 원자료는 일부 있으나 화면과 집계가 없음 |

전체적으로 보면 **약 50~60% 정도가 반영된 운영 가능한 v1**이다.  
다만 지금 빠진 40~50%는 부가 기능만이 아니라, 처음 이야기한 “왜 재고를 기록하는가”의 핵심인 **세일 시점 구매량 계산**과 연결된 부분이다.

---

## 2. 대화에서 구상한 3개 DB와 현재 구현 비교

### 대화에서 구상한 구조

```text
Consumables DB
제품 자체의 기준 정보

Purchase Log DB
언제, 어디서, 몇 개를, 얼마에 샀는지

Inventory Batch DB
실제로 보유한 개별 병·통·봉지와 개봉·소진 기록
```

### 현재 코드의 실제 구조

```text
inventory_products
제품 설정 + 현재 재고 스냅샷

inventory_events
입고·사용·개봉·소진·재고 정정 이벤트

inventory_usage_cycles
완료된 개봉→소진 주기
```

근거:

- `supabase/20260719_01_inventory_tables.sql`
  - `inventory_products`: 14–70행
  - `inventory_events`: 79–103행
  - `inventory_usage_cycles`: 111–141행
- `README.md`: 데이터 구조 설명 23–30행

현재 구조는 원래 구상한 DB를 그대로 옮기지 않고 다음처럼 재해석한 것이다.

| 원래 구상 | 현재 구현 | 차이 |
|---|---|---|
| Consumables DB | `inventory_products` | 핵심 재고 필드만 구현 |
| Purchase Log DB | `inventory_events`의 `intake` | 날짜·양만 남고 가격·구매처 없음 |
| Inventory Batch DB | `inventory_usage_cycles` | 개별 재고가 아니라 이미 다 쓴 제품의 사용 주기 |
| 현재 재고 합계 | `inventory_products.current_quantity` | 별도 batch 합산이 아니라 제품 행에 직접 저장 |

이 구조는 입력이 간단하고 개인용 앱 v1으로는 합리적이다.  
하지만 **구매 분석과 개별 batch 관리에는 필요한 정보가 부족하다.**

---

## 3. 잘 반영된 내용

## 3.1 개수형과 용량형 재고

제품 등록 시 두 가지 기준을 선택할 수 있다.

- 개수로 관리
- 용량으로 관리

관련 코드:

- `src/components/ProductEditor.tsx`: 142–160행
- `src/types.ts`: `tracking_mode`
- `supabase/20260721_01_capacity_stock_units.sql`: 용량 제품은 `g`, `ml` 등의 단위로 `current_quantity` 저장

예:

```text
소고기 소분 6통 → 개수형
구연산 5,000g → 용량형
토너 총 600ml → 용량형
```

이는 대화에서 말한 “모든 것이 가루와 액체류이고, 어떤 것은 개수로, 어떤 것은 용량으로 관리한다”는 요구를 직접 반영한 부분이다.

---

## 3.2 모든 재고 변경을 이벤트로 기록

다음 행동이 모두 `inventory_events`에 저장된다.

- 입고
- 사용
- 개봉
- 소진
- 재고 정정

`record_inventory_action()` RPC가 재고 변경과 이벤트 생성을 한 트랜잭션 안에서 처리한다.

관련 코드:

- `supabase/20260721_01_capacity_stock_units.sql`: 132–313행
- `src/types.ts`: 29–42행
- `README.md`: 25–30행

이 방식의 장점은 현재 수량만 남기는 것이 아니라 **왜 수량이 바뀌었는지 이력도 보존한다는 것**이다.

---

## 3.3 개봉일·소진일 기반 사용 주기 학습

용량형 제품은 다음 흐름으로 기록한다.

```text
새 제품 개봉
→ active_opened_on 저장
→ 다 씀
→ inventory_usage_cycles에 opened_on / finished_on / duration_days 저장
```

관련 코드:

- `supabase/20260721_01_capacity_stock_units.sql`: 196–258행
- `src/components/ActionDialog.tsx`: 142–170행
- `src/components/ProductCard.tsx`: 94–120행, 211–223행

즉, 허블룸 크림의 과거 메모였던:

```text
겨울 6개월에 4통 필요
```

를 앞으로는 실제 데이터로 바꿀 수 있는 기반이 있다.

```text
2026-11-01 개봉
2026-12-12 소진
42일 사용
```

이 기록이 여러 번 쌓이면 한 통의 실제 사용 기간을 계산할 수 있다.

---

## 3.4 최근 기록의 중앙값 사용

최근 5개의 완료된 사용 주기를 가져와 중앙값으로 예상 사용 기간을 계산한다.

관련 코드:

- `src/lib/inventory.ts`: 53–76행
- `src/lib/__tests__/inventory.test.ts`: 127–129행

이는 한 통이 유난히 빨리 또는 늦게 소진된 경우 평균이 크게 흔들리는 문제를 줄인다.

예:

```text
48일, 92일, 51일, 53일
중앙값 = 52일
```

대충 적어둔 “1년에 4통”보다 실제 행동에 기반한 보정값을 얻으려는 목적과 잘 맞는다.

---

## 3.5 사용 인원 변화 보정

과거에는 2명이 사용했고 현재는 1명이 사용하는 경우, 사용 기간을 인원수에 맞게 보정한다.

관련 코드:

- `src/lib/inventory.ts`: 61–74행
- `src/lib/__tests__/inventory.test.ts`: 64–70행

예:

```text
2명이 76일 사용
→ 1명 기준 예상 약 152일
```

대화에서 직접 논의한 내용보다 오히려 한 단계 더 정교하게 구현된 부분이다.

---

## 3.6 예상 소진일과 구매 필요 경고

구매 필요 여부는 두 가지 기준으로 판단한다.

```text
현재 재고 <= 설정한 최소 재고
또는
예상 소진일까지 남은 날 <= alert_days
```

관련 코드:

- `src/lib/inventory.ts`: 34–49행
- `src/components/ProductEditor.tsx`: 259–282행
- `src/components/ProductCard.tsx`: 132–143행

이는 대화에서 말한 안전재고 개념을 단순화한 구현이다.

예:

```text
100ml 이하이면 빨간불
또는
예상 소진 30일 전부터 빨간불
```

“급하게 쿠팡에서 정가에 사는 상황을 피한다”는 최소 목적에는 도움이 된다.

---

## 3.7 과거 날짜 입력과 JSON 백업

며칠 전의 입고·개봉·소진도 뒤늦게 기록할 수 있고, 제품·이벤트·사용 주기를 JSON으로 백업할 수 있다.

관련 코드 및 문서:

- `src/components/ActionDialog.tsx`: 172–182행
- `README.md`: 20행, 77–79행

매일 꼬박꼬박 기록하지 않는 실제 사용 패턴을 고려한 기능이다.

---

## 4. 부분적으로만 반영된 내용

## 4.1 Consumables DB

현재 `inventory_products`에 있는 필드:

```text
name
tracking_mode
unit_label
package_size
capacity_unit
current_quantity
low_stock_threshold
alert_days
current_consumer_count
active_opened_on
notes
is_archived
```

관련 코드:

- `src/types.ts`: 7–27행
- `supabase/20260719_01_inventory_tables.sql`: 14–34행

대화에서 구상했던 Consumables DB와 비교하면 다음 필드가 없다.

```text
category
subcategory
brand
usage_pattern
active_months
monthly_usage
seasonal_usage
safety_stock
target_stock
preferred_retailer
good_price
emergency_price
procurement_strategy
```

따라서 지금 앱은 제품 마스터라기보다 **재고 계산에 필요한 최소 설정 행**에 가깝다.

메모 칸에 브랜드·선호 구매처를 적을 수는 있지만 구조화된 데이터가 아니므로 검색, 필터, 계산에는 사용할 수 없다.

---

## 4.2 안전재고

`low_stock_threshold`와 `alert_days`가 있으므로 안전재고 아이디어는 일부 구현되어 있다.

다만 원래 이야기한 방식은 다음에 가까웠다.

```text
현재 재고
- 다음 세일까지 필요한 양
- 안전재고
- 배송 리드타임
```

현재 앱은 다음만 본다.

```text
최소 수량 이하인가?
예상 소진일까지 N일 이하인가?
```

다음은 계산하지 않는다.

- 다음 세일까지 남은 기간
- 다음 세일까지 필요한 수량
- 브랜드별 할인 빈도
- 배송 소요일
- 블프에 확보할 1년치 수량
- 현재 재고를 뺀 실제 구매 추천량

즉 **재고 부족 경고**는 있지만 **세일 전략형 구매 계획**은 아직 없다.

---

## 4.3 허블룸 크림 사용량 추적

허블룸 크림 한 통의 개봉일과 소진일을 기록하여 실제 사용 기간을 학습하는 기능은 구현되어 있다.

그러나 현재 방식으로 50ml 크림 5통을 샀다면 다음처럼 입력해야 한다.

```text
제품 1개 용량: 50ml
현재 남은 총 용량: 250ml
```

앱에서는 `250ml`로 보이고 실제 보유 개수인 `5통`은 표시되지 않는다.

따라서 다음 질문에는 답하기 어렵다.

```text
지금 미개봉이 몇 통 남았는가?
이번 겨울에 총 몇 통을 썼는가?
블프 때 몇 통을 사야 하는가?
```

개봉→소진 주기 자체는 수집되지만 **“통 개수”와 “한 통의 용량”이 분리되어 있지 않다.**

---

## 4.4 구연산 연간 사용량

구연산 5kg을 용량형으로 등록하고 개봉→소진을 기록하면 다음 원자료는 쌓인다.

```text
5,000g 한 봉지를 며칠 동안 사용했는가
1일 평균 몇 g을 사용했는가
```

현재 앱은 1일 사용량과 예상 소진일을 계산할 수 있다.

관련 코드:

- `src/lib/inventory.ts`: 79–108행
- `src/components/ProductCard.tsx`: 106–118행

하지만 다음 값은 화면에 표시하지 않는다.

```text
연간 예상 사용량
지난 12개월 실제 사용량
연도별 비교
1년에 몇 봉지를 사는가
```

즉 “나는 1년에 구연산을 몇 kg 쓰는 인간인가?”라는 궁금증을 풀 원자료는 일부 생기지만, 그 답을 직접 보여주는 집계 기능은 아직 없다.

---

## 5. 구현되지 않은 내용

## 5.1 Purchase Log DB

현재 `intake` 이벤트는 다음만 기록한다.

```text
product_id
입고량
입고 전 재고
입고 후 재고
날짜
```

구매 분석에 필요한 다음 정보는 없다.

```text
retailer
quantity_bought
unit_count
package_size_at_purchase
total_price
unit_price
price_per_ml_or_g
discount_type
coupon
shipping_fee
normal_price
sale_price
purchase_reason
```

`ActionDialog`의 입고 화면에는 수량과 날짜만 있고 메모 입력도 재고 정정일 때만 표시된다.

관련 코드:

- `src/components/ActionDialog.tsx`: 99–121행
- `src/components/ActionDialog.tsx`: 메모는 184–193행에서 adjustment에만 제공
- `supabase/20260719_01_inventory_tables.sql`: `inventory_events` 79–103행

따라서 다음 분석은 현재 불가능하다.

```text
더랩 토너를 네이버와 쿠팡 중 어디서 더 싸게 샀는가
평소 세일가는 얼마인가
긴급 구매로 2,000~3,000원을 더 쓴 횟수
블프 구매가와 추가 구매가의 차이
```

Purchase Log는 사실상 아직 시작되지 않은 상태다.

---

## 5.2 진짜 Inventory Batch DB

현재 앱에는 다음과 같은 개별 재고 행이 없다.

```text
허블룸 크림 #1
허블룸 크림 #2
허블룸 크림 #3
허블룸 크림 #4
허블룸 크림 #5
```

따라서 batch별로 다음을 저장하지 않는다.

```text
purchase_id
status
initial_quantity
remaining_quantity
opened_date
used_up_date
expiry_date
PAO
storage
lot_number
```

`inventory_usage_cycles`는 제품을 다 쓴 뒤 생성되는 완료 기록이지, 현재 보유 중인 각 제품의 batch가 아니다.

즉 현재 구조는 다음이다.

```text
현재 재고 총합 250ml
현재 사용 중인 제품의 개봉일 1개
완료된 사용 주기 여러 개
```

현재 보유한 5개 제품을 각각 관리하지 않으므로 **Inventory Batch DB는 구현되지 않았다.**

다만 이전 대화에서 “모든 병을 개별 페이지로 만드는 것이 정말 필요한가?”를 고민했던 점을 생각하면, 이 생략 자체는 의도적인 단순화로 볼 수 있다.

---

## 5.3 계절성

허블룸 크림은 11월~5월에만 사용하지만 현재 제품 모델에는 사용 월이나 시즌 정보가 없다.

없는 필드 예:

```text
usage_pattern = seasonal
active_months = [11, 12, 1, 2, 3, 4, 5]
season_start
season_end
season_name
```

현재 예측은 제품을 앞으로도 계속 같은 속도로 사용할 것으로 본다.

따라서 겨울이 끝난 뒤 사용을 중단해도:

- 사용 중단 기간을 인식하지 못하고
- 다음 겨울 필요량을 계산하지 못하며
- “이번 시즌에 실제 몇 통을 썼는지” 집계하지 못한다.

허블룸 블프 1년치 구매 문제를 해결하려면 계절성 지원이 필요하다.

---

## 5.4 세일·가격 전략

대화에서 제품별 구매 전략은 서로 달랐다.

```text
더랩
- 거의 매달 할인
- 할인폭 차이는 작음
- 정가 긴급 구매를 피하는 것이 중요

허블룸
- 블프 할인폭이 큼
- 1년치를 한 번에 확보하는 것이 중요
```

현재 제품 모델은 이 차이를 표현하지 못한다.

필요한 개념 예:

```text
procurement_strategy
- frequent_discount
- annual_bulk
- buy_when_low
- emergency_only

good_price
emergency_price
preferred_retailer
major_sale_month
target_coverage_months
safety_units
```

이 정보가 없으므로 앱은 “곧 부족하다”까지는 알려주지만 “지금 세일에서 몇 개를 사는 것이 좋은가”는 알려주지 못한다.

---

## 5.5 연간·시즌 구매 추천량

현재 앱은 예상 소진일을 계산하지만 다음 공식은 없다.

```text
다음 시즌 예상 사용량
+ 안전재고
- 현재 재고
= 이번 세일 구매 추천량
```

예:

```text
허블룸 크림
최근 한 통 사용 기간 중앙값: 37일
겨울 사용 기간: 210일
필요량: 210 / 37 = 5.68통
안전재고: 1통
현재 재고: 1통

블프 추천 구매량:
ceil(5.68 + 1 - 1) = 6통
```

이것이 과거의 “겨울 6개월에 4통”이라는 잘못된 추정을 실제 데이터로 교정하는 최종 기능인데, 현재는 아직 없다.

---

## 6. 가장 중요한 구조적 문제

## 6.1 재고 기준과 사용 기록 방식이 하나의 필드에 묶여 있음

현재 `tracking_mode`는 다음 둘 중 하나다.

```text
count
cycle
```

UI에서는 이를 다음처럼 설명한다.

```text
count = 개수로 관리
cycle = 용량으로 관리
```

동시에 동작도 다음처럼 고정된다.

```text
count
- 재고를 개수로 저장
- 사용할 때 수량 차감
- 개봉→소진 주기 기록 불가

cycle
- 재고를 ml/g로 저장
- 개봉→소진 주기 기록
- 개수형 재고 표시 불가
```

즉 서로 다른 두 개념이 하나의 선택지로 합쳐져 있다.

### 실제로 필요한 두 축

```text
stock_basis
- count
- capacity

usage_tracking
- decrement
- open_finish_cycle
```

이렇게 분리하면 네 가지 조합이 가능하다.

| 재고 기준 | 사용 기록 | 예시 |
|---|---|---|
| count | decrement | 소고기 소분 통 |
| count | open_finish_cycle | 허블룸 크림, 토너, 치약, 식초 |
| capacity | decrement | 매번 실제 g/ml 사용량을 입력하는 재료 |
| capacity | open_finish_cycle | 대용량 용기의 남은 양까지 정밀 추적하는 경우 |

현재 사용자에게 가장 필요한 조합은 **count + open_finish_cycle**인데 현재 코드에는 없다.

### 허블룸에 필요한 모델

```text
현재 재고: 5통
한 통 용량: 50ml
현재 한 통 사용 중
한 통 예상 사용 기간: 37일
```

현재 모델:

```text
현재 재고: 250ml
한 통 용량: 50ml
현재 사용 중
```

현재 구현도 계산은 가능하지만 사용자가 실제로 보는 재고 단위와 구매 단위가 사라진다.

이 문제는 데이터가 많이 쌓인 뒤보다 지금 수정하는 편이 훨씬 쉽다.

---

## 6.2 용량형 `current_quantity`의 의미가 일관되지 않음

용량형 제품을 개봉해도 DB의 `current_quantity`는 줄지 않는다.

예:

```text
50ml 크림 5통 = 250ml
첫 통 개봉
DB current_quantity = 여전히 250ml
```

예측 함수에서는 개봉 후 지난 날짜를 바탕으로 사용량을 추정하여 남은 기간 계산 때만 차감한다.

관련 코드:

- 개봉 시 수량 미차감: `supabase/20260721_01_capacity_stock_units.sql` 196–217행
- 예상 계산에서 경과 사용량 차감: `src/lib/inventory.ts` 79–96행
- 카드에는 원래 `current_quantity` 표시: `src/components/ProductCard.tsx` 47–48행, 63–67행

따라서 화면에는 실제보다 많은 총 용량이 표시될 수 있다.

```text
표시 재고: 250ml
실제 추정 재고: 약 238ml
```

“현재 재고”가 다음 중 무엇인지 명확하지 않다.

1. 구매 당시의 명목상 총 용량
2. 현재 실제 남은 총 용량
3. 미개봉 제품의 총 용량 + 사용 중 제품의 추정 잔량

현재 코드에서 저장값은 1번에 가깝고, 예측 계산은 3번에 가깝고, UI 문구는 2번처럼 보인다.

---

## 6.3 사용 중 재고 정정을 하면 이중 차감될 가능성

용량형 제품의 재고 정정 화면은 다음 값을 입력하라고 한다.

```text
지금 직접 확인한 남은 총 용량
```

관련 코드:

- `src/components/ActionDialog.tsx`: 123–139행

하지만 소진할 때는 무조건 제품 한 개의 전체 용량을 차감한다.

- `supabase/20260721_01_capacity_stock_units.sql`: 219–235행

예:

```text
제품 1개 = 50ml
개봉 전 총 재고 = 250ml
중간에 실제 남은 총량을 230ml로 재고 정정
나중에 다 씀 처리
→ 다시 50ml 차감
→ 180ml
```

중간 정정값 230ml에 이미 사용 중 제품의 감소량이 반영되어 있다면, 소진 시 전체 50ml를 다시 빼는 것은 과도한 차감이 된다.

현재 방식에서는 재고 정정이 다음 중 어느 의미인지 분리할 필요가 있다.

```text
명목 재고 정정
실제 잔량 정정
미개봉 재고 정정
```

---

## 6.4 DB 제약조건과 새 용량 모델의 충돌 가능성

초기 migration에는 다음 제약조건이 있다.

```sql
constraint inventory_products_cycle_quantity_whole
check (tracking_mode <> 'cycle' or current_quantity = trunc(current_quantity))
```

위치:

- `supabase/20260719_01_inventory_tables.sql`: 66–67행

이는 `cycle` 제품의 `current_quantity`가 정수여야 한다는 뜻이다.

하지만 최신 구현은:

- 용량 제품에 `step="any"` 허용
- `numeric(12, 3)` 사용
- 남은 총 용량을 소수로 입력 가능하게 설계

관련 코드:

- `src/components/ProductEditor.tsx`: 190–203행
- `src/components/ActionDialog.tsx`: 123–139행

검토한 최신 capacity migration에는 이 제약조건을 제거하는 구문이 보이지 않는다.

따라서 `12.5g`, `87.5ml` 같은 값은 UI에서는 허용되지만 DB에서 거부될 수 있다.

용량을 g/ml 정수 단위로만 사용할 계획이라도, 코드의 의도와 DB 규칙은 맞춰두는 편이 안전하다.

---

## 6.5 내부 이름 `cycle`과 화면 의미 `capacity`가 다름

내부에서는 `tracking_mode === "cycle"`이지만 화면에서는 “용량으로 관리”라고 부른다.

처음에는 `cycle`이 “개봉→소진 방식”을 의미했지만, 최신 변경에서 “용량형 재고” 의미까지 맡게 된 것으로 보인다.

이 이름 혼합은 앞으로 다음 기능을 추가할 때 혼란을 만든다.

```text
개수형인데 cycle을 측정하는 제품
용량형인데 매번 사용량을 차감하는 제품
```

지금 `tracking_mode`를 분리하거나 이름을 바꾸는 것이 좋다.

---

## 7. 품목별 현재 적용 가능성

## 7.1 허블룸 겨울 크림

### 현재 코드에서 가능한 방식

```text
tracking_mode: cycle
package_size: 50
capacity_unit: ml
current_quantity: 250
```

장점:

- 한 통 개봉일·소진일 기록 가능
- 한 통 사용 기간 학습 가능
- 예상 소진일 계산 가능

한계:

- 5통이라는 구매 단위가 화면에서 사라짐
- 겨울 시즌만 사용한다는 정보 없음
- 블프 추천 구매량 없음
- batch별 유통기한 없음

### 추천 모델

```text
stock_basis: count
usage_tracking: open_finish_cycle
current_units: 5
unit_label: 통
package_size: 50
package_unit: ml
active_months: [11, 12, 1, 2, 3, 4, 5]
safety_units: 1
```

---

## 7.2 더랩 하이드로 토너

### 필요한 정보

```text
현재 몇 병 있는가
한 병을 며칠 쓰는가
9월~5월에만 사용하는가
다음 할인 기회 전까지 버티는가
평소 할인가보다 비싼 긴급 구매였는가
```

현재 앱은 한 병 사용 기간과 예상 소진일은 학습할 수 있다.

아직 없는 것:

```text
병 개수 + 개봉 주기 동시 관리
9~5월 사용
구매 가격
구매처
정상 할인가 범위
```

---

## 7.3 구연산 5kg

관리 목적이 구매 실패 방지보다 연간 소비량 관찰이라면 가장 간단한 방식은 다음이다.

```text
재고: 1봉
한 봉: 5,000g
개봉일
소진일
```

한 봉의 사용 기간만 알아도 다음을 계산할 수 있다.

```text
연간 예상 사용량 = 5,000g × 365 / 한 봉 사용 일수
연간 예상 봉지 수 = 365 / 한 봉 사용 일수
```

현재 앱은 한 봉을 `5,000g` 용량형으로 기록할 수 있지만, 연간 환산값은 표시하지 않는다.

---

## 7.4 브래그 식초·오트밀·참기름

이 제품들도 대체로 다음 조합이 적합하다.

```text
재고는 병/봉 개수
사용 주기는 개봉→소진
제품 용량은 ml/g
```

즉 액체와 가루라는 이유만으로 재고 자체를 ml/g로 관리하기보다:

```text
구매·재고 단위 = 병/봉
소비량 환산 단위 = ml/g
```

를 분리하는 편이 입력이 쉽고 실제 구매 행동과도 맞는다.

---

## 8. 추천하는 최소 수정 방향

진짜 Inventory Batch DB를 바로 만드는 것보다, 현재 구조를 유지하면서 제품 모델을 먼저 바로잡는 편이 낫다.

## 8.1 제품 필드 분리

```sql
stock_basis text
-- count | capacity

usage_tracking text
-- decrement | cycle

stock_unit_label text
-- 통, 병, 봉, 팩

package_size numeric
package_unit text
-- ml, g

current_units numeric
-- count 방식이면 보유 개수
-- capacity 방식이면 실제 남은 용량
```

기존 `tracking_mode` 하나가 맡고 있던 두 역할을 분리한다.

---

## 8.2 count + cycle 지원

개봉 시:

```text
current_units는 그대로 유지
active_opened_on 저장
```

소진 시:

```text
current_units에서 1 차감
usage_cycle 생성
active_opened_on 초기화
```

예상 남은 기간:

```text
사용 중 제품의 예상 잔여일
+ 미개봉 제품 수 × 한 제품 예상 사용 일수
```

예:

```text
현재 5통
한 통 평균 40일
현재 통을 10일 사용함

예상 잔여일
= 현재 통 약 30일
+ 미개봉 4통 × 40일
= 190일
```

이 방식이면 허블룸, 토너, 치약, 식초, 오트밀을 자연스럽게 처리할 수 있다.

---

## 8.3 Purchase Log를 별도 테이블로 추가

```sql
inventory_purchases
- id
- workspace_id
- product_id
- purchased_on
- retailer
- package_count
- package_size
- package_unit
- total_price
- shipping_fee
- discount_type
- note
- created_at
```

계산값:

```text
price_per_package
price_per_100ml
price_per_100g
```

입고 이벤트와 구매 로그는 연결하되 같은 것으로 취급하지 않는 편이 좋다.

이유:

- 구매했지만 아직 배송되지 않을 수 있음
- 사은품이 포함될 수 있음
- 구매 수량과 실제 입고 수량이 다를 수 있음
- 가격 분석은 재고 이벤트와 별도 관심사임

---

## 8.4 계절성은 제품에 최소 필드만 추가

처음부터 복잡한 달력 DB를 만들 필요는 없다.

```sql
usage_pattern text
-- year_round | seasonal | occasional

active_months integer[]
-- 예: {11,12,1,2,3,4,5}
```

이 두 필드만 있어도 허블룸과 더랩의 비사용 기간을 예측에서 제외할 수 있다.

---

## 8.5 연간 소비 통계는 기존 cycle에서 파생

별도 입력을 늘리지 않고 다음을 계산할 수 있다.

```text
한 제품 예상 사용 일수
연간 예상 제품 수
연간 예상 ml/g
최근 12개월 실제 소진 제품 수
시즌별 실제 사용 제품 수
```

예:

```text
한 통 42일
한 통 50ml

연간 환산:
365 / 42 = 8.69통
8.69 × 50ml = 약 435ml
```

시즌 제품이면 365일 대신 활성 월의 총 일수를 사용한다.

---

## 8.6 구매 추천량

제품에 다음 필드만 추가해도 계산 가능하다.

```text
safety_units
target_until_date 또는 target_coverage_days
```

공식:

```text
예상 필요 개수
= ceil(목표 기간 / 한 제품 예상 사용 일수)

구매 추천 개수
= max(0, 예상 필요 개수 + 안전재고 - 현재 재고)
```

허블룸:

```text
목표 기간 = 다음 겨울 210일
한 통 평균 = 37일
안전재고 = 1통
현재 재고 = 1통

ceil(210 / 37) + 1 - 1
= 6통
```

이 기능이 구현되면 과거 메모의 “4통 필요”를 실제 데이터가 자동으로 교정할 수 있다.

---

## 9. 구현 우선순위

## P0 — 실제 데이터가 많이 쌓이기 전에 수정

1. `tracking_mode`를 재고 기준과 사용 기록 방식으로 분리
2. `count + cycle` 조합 지원
3. 용량형 `current_quantity`의 의미 확정
4. `inventory_products_cycle_quantity_whole` 제약조건 검토
5. 사용 중 재고 정정 후 소진 시 이중 차감 문제 해결

이 단계는 데이터 구조 자체에 영향을 주므로 가장 먼저 처리하는 편이 좋다.

---

## P1 — 지금 앱의 목적을 완성

1. 활성 월 또는 시즌 필드
2. 연간·시즌 예상 사용량
3. 현재 재고를 반영한 구매 추천 개수
4. 안전재고 개수
5. 최근 12개월 실제 사용량 통계

이 단계까지 오면 허블룸과 더랩의 “항상 한 통 모자람” 문제가 실제로 해결되기 시작한다.

---

## P2 — 세일 구매 최적화

1. Purchase Log 테이블
2. 구매처
3. 총 결제금액
4. 개당·100ml·100g 가격
5. 평소 좋은 가격
6. 긴급 구매 가격
7. 할인 유형
8. 블프·올영·네이버·쿠팡 가격 비교

이 단계에서 “쿠팡에서 2~3천 원 비싸게 사서 속 쓰린 상황”을 수치로 확인할 수 있다.

---

## P3 — 필요성을 느낄 때만 batch 확장

1. 유통기한
2. PAO
3. 보관 위치
4. 구매 batch
5. 여러 제품 동시 개봉
6. lot 번호

현재 사용 패턴에서는 모든 병·통마다 페이지를 만드는 진짜 batch 시스템은 입력 피로가 클 수 있다.

우선 `count + cycle`만 지원해도 대부분의 목적을 달성할 가능성이 높다.

---

## 10. 최종 판단

현재 앱은 처음 대화에서 이야기한 시스템을 엉뚱하게 구현한 것이 아니다.

오히려 다음 핵심은 꽤 잘 잡혀 있다.

```text
현재 재고를 안다
실제 사용 기록을 쌓는다
대충 추정했던 소비 속도를 실제 데이터로 교정한다
소진이 가까워지면 알려준다
```

다만 대화에서 최종적으로 원했던 것은 그보다 한 단계 더 나아간다.

```text
나는 실제로 1년에 얼마나 쓰는가
다음 세일까지 버틸 수 있는가
이번 큰 세일에서 몇 개를 사야 하는가
정가 긴급 구매를 얼마나 피했는가
```

현재 코드는 첫 번째 단계인 **재고 관측과 사용 주기 학습**은 구현했다.  
두 번째 단계인 **계절 수요 예측과 가격 기반 구매 계획**은 아직 구현되지 않았다.

그리고 기능을 더 붙이기 전에 가장 먼저 손볼 부분은 Purchase Log나 Batch DB가 아니라 다음 한 가지다.

> **재고를 무엇으로 세는가와, 사용 속도를 어떤 방식으로 측정하는가를 분리한다.**

이 구조가 분리되면 허블룸 크림을 “5통 보유 + 한 통씩 개봉·소진 측정”으로 자연스럽게 관리할 수 있고, 토너·치약·식초·오트밀·구연산까지 같은 모델 안에서 무리 없이 확장할 수 있다.
