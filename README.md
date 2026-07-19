# 우리집 재고

집안의 식재료와 생활용품 재고를 휴대폰에서 바로 확인하고, 실제 사용 기록으로 구매 주기를 학습하는 개인용 앱입니다.

**목표 배포 주소:** https://mworkroom.github.io/inventory-tracker/

`main` 브랜치에 소스가 올라가고 GitHub Pages가 활성화되면 이 주소로 배포됩니다.

## 첫 버전 기능

- 제품 등록
- 입고, 사용, 개봉, 소진, 재고 정정
- 목록을 누르면 카드가 펼쳐지는 모바일 중심 UI
- 빨간 점으로 구매 필요 품목 표시
- 개수 방식: 사용 기록 간격으로 남은 기간 계산
- 개봉·소진 방식: 최근 5회 중앙값으로 한 제품의 사용 기간 계산
- 사용 인원 변화 보정
  - 예: 2명이 76일 쓴 제품 → 1명 기준 약 152일
- 제품 용량이 있으면 1인 하루 사용량 계산
- JSON 백업 파일 다운로드
- Google 로그인 + workspace 기반 RLS

## 데이터 구조

- `inventory_products`: 제품 설정과 현재 재고 스냅샷
- `inventory_events`: 모든 입고·사용·개봉·소진·정정 기록
- `inventory_usage_cycles`: 완료된 개봉→소진 주기
- workspace: `00000000-0000-0000-0000-000000000002`

현재 수량 변경은 `record_inventory_action()` RPC 안에서 이벤트 기록과 함께 원자적으로 처리됩니다. 공개 브라우저에는 Supabase publishable key만 포함하며, 실제 데이터 접근은 RLS가 제한합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

기본 Supabase 프로젝트가 소스에 연결되어 있습니다. 다른 프로젝트를 쓸 때만 `.env.example`을 참고해 환경변수를 설정합니다.

```bash
npm run verify
```

`verify`는 TypeScript/Vite 빌드와 사용 주기 계산 테스트를 모두 실행합니다.

## 배포

`main`에 push되면 GitHub Actions가 검증·빌드 후 GitHub Pages에 배포합니다.

Google 로그인 후 원래 페이지로 돌아오지 않는 경우 Supabase Dashboard의 **Authentication → URL Configuration → Redirect URLs**에 아래 주소를 추가합니다.

```text
https://mworkroom.github.io/inventory-tracker/
```

## 백업

상단 설정 메뉴의 **JSON 백업 저장**을 누르면 제품, 이벤트, 완료된 사용 주기를 한 파일로 내려받습니다.
