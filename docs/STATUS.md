# 현황 — 최종 확인: 2026-11-06(금)
> 덮어쓰기 문서. 지금 상태만 6KB 이하로 쓴다(`wc -c docs/STATUS.md`). 지난 일은 `docs/buildlog/`에. `/wrap`이 갱신한다.

## 0. 한 줄
초대 기반으로 운영 중인 모바일 우선 PWA. 필터 툴바·내 폴더 등 모바일 화면을 다듬는 중이고, 작업 규약(하네스)을 막 깔았다.

## 1. 다음 첫 작업
#5 분류·#6 검색·#7 최신순 고침(2026-11-08, 배포). 다음 새벽 수집 뒤 분류가 실제로 바뀌었는지 확인(아우터에 후드 집업, 스커트가 스커트에). #4 리뉴얼은 보류. 안전망: `npm run ui-smoke`·`test:taxonomy`·`test:search`·`test:first-seen`.


## 2. ▶ 사용자 할 일
없음

## 3. 안 되는 것 — 정직하게
- 자동 테스트 없음. `npm run check`는 문법·JSON·taxonomy 사본만 보고 동작은 보장 안 함.
- 최근 화면 변경(필터 툴바·b6ec794 품절 제외 칩)은 2026-11-06 사용자가 모바일에서 직접 확인함(에이전트는 확인 안 함).

## 4. 어디에 뭐가 있나
| 무엇 | 어디(경로·URL) | 상태 |
|---|---|---|
| 규약 | `AGENTS.md` | 유효 |
| 할 일 | `docs/TASKS.md` | 유효 |
| 작업 일지 | `docs/buildlog/2026-11.md` | 유효 |
| 디자인 규약·승인본 | `docs/UI_GUIDE.md`, `docs/design/confirmed/` | 유효 |
| 저장소 | https://github.com/gjssk159-sudo/style-finder | 유효 |
| 인수인계·세팅·구조 | `docs/HANDOFF.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md` | 유효 |
| 매일 수집 | `.github/workflows/collect.yml`(KST 05:00), `collect-single.yml` | 11-04~06 연속 성공 |
