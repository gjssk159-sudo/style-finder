# 현황 — 최종 확인: 2026-11-06(금)
> 덮어쓰기 문서. 지금 상태만 6KB 이하로 쓴다(`wc -c docs/STATUS.md`). 지난 일은 `docs/buildlog/`에. `/wrap`이 갱신한다.

## 0. 한 줄
초대 기반으로 운영 중인 모바일 우선 PWA. 필터 툴바·내 폴더 등 모바일 화면을 다듬는 중이고, 작업 규약(하네스)을 막 깔았다.

## 1. 다음 첫 작업
#2 인수인계 문서 양식 채우기(`docs/HANDOFF.md`·`docs/SETUP.md`·`docs/ARCHITECTURE.md`). 남은 빈칸 확인: `grep -n "채우기" docs/*.md`

## 2. ▶ 사용자 할 일
없음

## 3. 안 되는 것 — 정직하게
- 자동 테스트 없음. `npm run check`는 문법·JSON·taxonomy 사본만 보고 동작은 보장 안 함.
- 최근 화면 변경(b6ec794 품절 제외 칩 등)은 이번 세션에서 브라우저로 다시 확인하지 않음(미검증).
- `docs/HANDOFF.md`·`docs/SETUP.md`·`docs/ARCHITECTURE.md`는 아직 빈 양식. `docs/DECISIONS.md`에는 D-1만 있음(날짜 미기입).

## 4. 어디에 뭐가 있나
| 무엇 | 어디(경로·URL) | 상태 |
|---|---|---|
| 규약 | `AGENTS.md` | 유효 |
| 할 일 | `docs/TASKS.md` | 유효 |
| 작업 일지 | `docs/buildlog/2026-11.md` | 유효 |
| 디자인 규약·승인본 | `docs/UI_GUIDE.md`, `docs/design/confirmed/` | 유효 |
| 저장소 | https://github.com/gjssk159-sudo/style-finder | 유효 |
| 매일 수집 | `.github/workflows/collect.yml`(KST 05:00), `collect-single.yml` | 유효 |
