# 우리집 재고

집안의 식재료와 생활용품 재고를 휴대폰에서 바로 확인하고, 실제 사용 기록과 구매 기록으로 다음 소진·구매 시점을 학습하는 개인용 앱입니다.

**배포 주소:** https://mworkroom.github.io/inventory-tracker/

## 문서 기준

- [운영·계산 규칙](docs/inventory-rules.md): 기록의 의미, 계산 우선순위, 예외와 현재 모델의 한계를 정한 단일 기준 문서
- [도메인 용어](CONTEXT.md): 구매·입고·사용·재고 정정 등 앱에서 사용하는 용어의 뜻
- [1인 소비 기준 결정](docs/adr/0001-one-person-consumption-baseline.md): 공동 사용 기록을 개인 소비 기준으로 환산하기로 한 결정

## 주요 기능

- 제품 등록과 복수 구매처 연결
- 입고, 사용, 개봉, 소진, 재고 정정
- 목록을 누르면 카드가 펼쳐지는 모바일 중심 UI
- 재고·소진 확인과 재구매 시기를 별도 상태로 표시
- 수량형: 최근 사용일의 간격과 사용량으로 남은 기간 계산
- 개봉형: 최근 완료 주기 5개의 중앙값으로 한 제품의 사용 기간 계산
- 개봉일과 소진일로 사용 주기 자동 기록
- 개봉형 사용 주기와 소비량을 개인 소비 기준으로 통일하고 실제 공동 사용 인원으로 각 주기를 보정
  - 예: 2명이 76일 쓴 제품 → 1명 기준 약 152일
- 제품 용량이 있으면 1인 하루 사용량 계산
- 구매일, 구매처, 수량, 용량, 결제금액, 배송비, 메모 기록
- 과거 구매일 여러 건 일괄 입력
- 최근 구매 간격의 중앙값과 다음 구매 예상일 계산
- 실제 사용 근거가 부족할 때 재고 추적 전 구매량으로 소비량 보조 추정
- 계절 제품의 활성 월, 사용 월 평균, 연간·시즌 예상 필요량 계산
- 다음 세일일, 목표 확보 개월 수와 안전 재고를 반영한 구매 수량 추천
- 카테고리별 / 구매처별 목록 전환
- 기록을 보존한 채 제품을 기본 목록에서 숨기고 다시 표시
- JSON 백업 파일 다운로드
- Google 로그인 + workspace 기반 RLS

## 구매 기록과 입고

두 기록은 서로 다른 목적으로 분리합니다.

```text
구매 기록
→ 언제 어디서 샀는지 저장
→ 현재 재고는 바뀌지 않음

입고
→ 실제 물건이 도착한 뒤 현재 재고 증가
```

과거 주문일을 여러 건 입력해도 현재 재고가 늘어나지 않습니다. 구매 기록은 구매 이력과 구매 간격의 원자료이며, 실제 사용 근거가 부족할 때는 재고 추적 시작 전 구매량을 보조 소비 추정에 사용할 수 있습니다. 실제 사용 기록으로 소비 속도를 계산할 수 있게 되면 실제 사용 근거가 구매량 추정보다 우선합니다.

## 사용과 재고 정정

두 버튼은 숫자의 의미가 다릅니다.

```text
사용
→ 이번에 실제로 사용한 수량 입력
→ 현재 재고에서 차감
→ 소비 속도 학습에 포함

재고 정정
→ 지금 실물을 세어 확인한 현재 수량 입력
→ 현재 재고를 입력값으로 교체
→ 소비 속도 학습에는 포함하지 않음
```

예를 들어 앱에 7개가 있고 실제로 면도날 1개를 사용했다면 `사용 1개`를 기록합니다. 반대로 과거 구매 기록을 모두 입력한 뒤 실물을 세어 7개가 남아 있다는 사실만 확인했다면 `재고 정정 7개`가 맞습니다. 과거 총구매량에서 7개를 뺀 값을 사용 기록으로 만들면 과거의 불명확한 소비가 현재 사용 속도에 섞이므로 잘못된 기록이 됩니다.

## 데이터 구조

- `inventory_products`: 제품 설정, 주구매처, 현재 재고 스냅샷
- `inventory_events`: 모든 입고·사용·개봉·소진·정정 기록
- `inventory_usage_cycles`: 완료된 개봉→소진 주기
- `inventory_stores`: 쿠팡·네이버·마켓컬리·아이허브·올리브영·자사몰 등의 구매처
- `inventory_purchases`: 재고와 분리된 과거·현재 구매 기록
- workspace: `00000000-0000-0000-0000-000000000002`

현재 수량 변경은 `record_inventory_action()` RPC 안에서 이벤트 기록과 함께 원자적으로 처리됩니다. 개봉 시에는 재고를 차감하지 않고 개봉일과 사용 인원만 저장하며, 소진 시 재고 1개를 차감하고 완료된 사용 주기를 자동 생성합니다. 구매 기록은 별도 테이블에 저장되므로 재고 수량을 변경하지 않습니다. 공개 브라우저에는 Supabase publishable key만 포함하며, 실제 데이터 접근은 RLS가 제한합니다.

`supabase/migrations/`의 기존 적용 이력은 그대로 보존합니다. v2 기준 migration이 Inventory Tracker의 핵심 테이블을 구성하고 이후 migration이 구매처 연결, 계절 설정, 기록 정정 등 기능을 확장합니다. 공유 Auth·workspace와 다른 앱 데이터는 건드리지 않습니다. 운영 적용 전에는 inventory 전용 백업과 별도 승인이 필요합니다.

## 코드 구조

- `App.tsx`: 인증 화면과 재고 작업 화면 연결
- `components/InventoryWorkspace.tsx`: 페이지 영역 조합
- `components/InventoryList.tsx`: 제품 그룹·카드·빈 상태 표시
- `components/InventoryDialogs.tsx`: 입력·수정 다이얼로그 표시
- `hooks/useInventoryWorkspaceController.ts`: 화면 상태와 사용자 작업 조정
- `hooks/useInventoryViewModel.ts`: 검색·필터·예측·그룹 계산
- `hooks/useInventory.ts`: 데이터와 변경 모듈을 합치는 공개 진입점
- `hooks/inventory/`: 조회, 제품, 재고 기록, 구매, 백업, 입력 검증

## 로컬 최초 실행

저장소를 새로 받으면 `node_modules`가 없으므로 설치가 먼저 필요합니다.

```bash
npm ci
npm run dev
```

`npm run dev`에서 `'vite'은(는) ... 아닙니다`가 나오면 아직 `npm ci` 또는 `npm install`을 실행하지 않은 상태입니다. Vite는 전역 프로그램이 아니라 이 프로젝트의 `devDependencies`로 설치됩니다.

`.env.example`을 `.env.local`로 복사하고 로컬에서 사용할 Supabase 값을 설정합니다. 소스 코드에는 프로젝트 URL이나 publishable key 기본값을 두지 않습니다.

GitHub Pages 배포는 저장소 **Settings → Secrets and variables → Actions → Variables**에 등록한 다음 Repository Variables를 빌드 시 주입합니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

```bash
npm run verify
```

`verify`는 TypeScript/Vite 빌드, 사용·구매 주기 계산 테스트, 새 스키마의 권한·기능 계약 검사를 모두 실행합니다.

## 배포와 흰 화면 방지

`main`에 push되면 GitHub Actions가 검증·빌드 후 GitHub Pages에 배포합니다.

Vite 프로젝트의 저장소 원본 `index.html`은 `/src/main.tsx`를 가리키므로, 원본 파일을 GitHub Pages가 그대로 서비스하면 브라우저에서 실행되지 않고 흰 화면이 생깁니다. Pages에는 반드시 Vite가 만든 `dist`가 배포되어야 합니다.

현재 배포 검사는 다음을 확인합니다.

- `dist/index.html`이 `/src/main.tsx`를 참조하지 않는지
- 배포 경로가 어느 하위 경로에서도 동작하는 상대 경로 `./assets/...`인지
- 실제 배포된 JavaScript 파일이 HTTP 200으로 내려오는지
- 앱 시작 또는 렌더링 오류가 발생하면 흰 화면 대신 오류 안내가 표시되는지

Google 로그인 후 원래 페이지로 돌아오지 않는 경우 Supabase Dashboard의 **Authentication → URL Configuration → Redirect URLs**에 아래 주소를 추가합니다.

```text
https://mworkroom.github.io/inventory-tracker/
```

## 백업

상단 설정 메뉴의 **JSON 백업 저장**을 누르면 제품, 재고 이벤트, 완료된 사용 주기, 구매처, 구매 기록을 한 파일로 내려받습니다.
