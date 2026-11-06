# 인수인계 (HANDOFF)
> 다른 사람·다른 컴퓨터·다른 AI 도구로 넘길 때 읽는 문서. 상한 15KB. **지금 상태는 `docs/STATUS.md`를 가리키기만** 하고 여기 복사하지 않는다. 비밀값은 이름만 쓴다.
> 최종 확인: 2026-11-06

## 1. 이 프로젝트는
- 국내 인디 패션 브랜드 자사몰 상품을 매일 모아 검색·필터하는 모바일 우선 PWA(마이셀렉트샵, 저장소 이름 style-finder).
- 초대받은 사용자가 로그인해서 '내 폴더'에 담은 브랜드의 상품만 본다.
- 운영 중이고 모바일 화면을 다듬는 중. 지금 상태는 `docs/STATUS.md`.

## 2. 띄우는 법
`docs/SETUP.md` 순서대로. 요약:
```
git clone https://github.com/gjssk159-sudo/style-finder.git
cd style-finder
npm ci
node web-server.js
```
→ http://localhost:5173

## 3. 환경변수 — 이름만
| 이름 | 용도 | 없으면 | 어디서 받나 |
|---|---|---|---|
| `SUPABASE_URL` | Supabase 주소(로컬 `.env`, Actions 시크릿) | 수집 적재 안 됨 | Supabase 대시보드 → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | 관리자 키. `src/`와 CI에서만 | 적재·동기화 안 됨 | 같은 곳(service_role) |
| `SUPABASE_ANON_KEY` | 공개 키(화면용, `web/config.js`에 있음) | 화면 조회 안 됨 | 같은 곳(anon) |
| `GH_DISPATCH_TOKEN` | Edge Function → 즉시 수집 워크플로우 실행 | 새 브랜드가 다음 날 정기 수집까지 안 보임 | GitHub 토큰, Supabase 함수 시크릿에 등록 |
| `NOTIFY_SECRET` | Q&A 트리거 ↔ `notify-qna` 공유 비밀 | Q&A 알림 안 옴 | Supabase 함수 시크릿 |
| `QNA_WEBHOOK_URL` | Q&A 알림을 Discord/Slack으로 | 그 알림만 안 옴 | 메신저 웹훅 설정 |
| `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID` | Q&A 텔레그램 알림 | 그 알림만 안 옴 | 텔레그램 봇(`src/telegram-setup.js`) |

## 4. 배포
- 화면: `main`에 push하면 Vercel이 자동 배포한다. 되돌리기는 Vercel 대시보드에서 이전 배포를 다시 올리거나 `git revert` 후 push.
- 수집: GitHub Actions가 매일 KST 05:00(`collect.yml`). 수동 실행은 Actions 탭 → "정기 수집" → Run workflow.
- Edge Functions·SQL: `supabase/` 아래 파일을 Supabase에 직접 적용. 민감 경로라 사용자 확인 후에만.

## 5. 되는 것 / 안 되는 것 — 정직하게
| 기능 | 상태 | 근거·메모 |
|---|---|---|
| 매일 수집·적재 | 됨 | 2026-11-04~06 "정기 수집" 3회 연속 success(`gh run list --workflow=collect.yml -L 3`) |
| 화면(로그인·내 폴더·필터) | 미검증 | 이번 세션에서 브라우저 확인 안 함 |
| 자동 테스트 | 없음 | `npm run check`는 문법·JSON·taxonomy 사본만 |

## 6. 함정 — 밟아 본 것
- push는 곧 운영 배포다. 확인 없이 push하지 않는다.
- `taxonomy.json`만 고치고 `web/taxonomy.json`을 안 바꾸면 화면 분류가 어긋난다.
- 아이콘을 같은 이름으로 바꾸고 `web/sw.js` `CACHE`를 안 올리면 옛 아이콘이 남는다.

## 7. 계정·권한
| 서비스 | 누구 계정 | 필요한 권한 |
|---|---|---|
| GitHub(`gjssk159-sudo/style-finder`) | 프로젝트 주인 | 저장소 쓰기, Actions 시크릿 |
| Supabase | 프로젝트 주인 | 프로젝트 관리자 |
| Vercel | 프로젝트 주인 | 프로젝트 배포 |
