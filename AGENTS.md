# AGENTS.md — 작업 규약 (정본)

사람과 AI 에이전트가 함께 따르는 유일한 규약이다. `CLAUDE.md`는 이 파일을 불러오기만 한다. **8KB 이하**(`wc -c AGENTS.md`, 한글 1자 3바이트). 결정은 `docs/DECISIONS.md`, 변하는 값은 `docs/STATUS.md`에만 둔다.

## 0. 절대 규칙
1. **검증 없이 완료라고 말하지 않는다.** 명령을 실제로 돌리고 출력과 exit 코드를 읽은 뒤 보고한다. "아마", "될 것"은 미검증이다. 새 검사는 되돌렸을 때 실패하는지까지 본다.
2. **결과를 지어내지 않는다.** 리뷰·CI·테스트 결과는 확인한 것만 인용한다. CI `in_progress`는 통과가 아니다. 리뷰 제안도 검증한 뒤 받아들인다.
3. **비밀값에 손대지 않는다.** `.env*`(`.env.example` 제외)·키 파일을 읽거나 출력하거나 커밋하지 않는다. 필요하면 변수 이름과 넣는 명령만 안내한다.
4. **사용자가 할 일은 붙여넣기 가능한 완성 명령으로** 준다. 에이전트가 할 수 있는 일은 넘기지 않는다.
5. **문서와 코드가 다르면 코드가 맞다.** 문서를 고치고 보고한다.
6. **같은 실수를 두 번 하면 규칙을 더한다.** 가능하면 검사·훅으로, 아니면 이 파일에 한 줄 + 근거(`D-n`, buildlog 날짜).
7. **훅이 막으면 우회하지 않는다.** `--no-verify`, 훅 삭제·이동, 환경변수 조작 금지.
8. 대화·문서는 한국어, 코드 식별자·커밋 type은 영어.

## 1. 프로젝트 한눈에
**마이셀렉트샵(style-finder)**: 국내 인디 패션 브랜드 자사몰 상품을 매일 수집해 검색·필터하는 모바일 우선 PWA. 사용자는 로그인 후 '내 폴더'에 담은 브랜드 상품만 본다. 단계: 운영 중(초대 기반), 모바일 화면 다듬는 중. 기술: Node 24(ESM, 빌드 없음)·Playwright·cheerio·Supabase(Auth·RLS·Edge Functions)·프레임워크 없는 HTML/JS·Vercel·Actions 크론. 테스트 없음.
| 위치 | 역할 | 명령 |
|---|---|---|
| `src/run.js`, `src/adapters/` | 수집기(플랫폼별 어댑터) → `data/out/` | `node src/run.js [--source=id]` |
| `src/add-brand.js` | URL 판별·브랜드 등록 | `node src/add-brand.js <URL>` |
| `src/reclassify.js`, `src/dedupe.js` | 카테고리 분류(`taxonomy.json`)·중복 묶기 | `node src/reclassify.js` |
| `src/load-supabase.js` | Supabase 적재(service 키, 로컬·CI 전용) | `node src/load-supabase.js` |
| `brands.json`·`taxonomy.json` | 브랜드 목록, 카테고리 사전 | — |
| `web/` | 화면(`index.html`·`app.js`·`sw.js`), anon 키로 Supabase 직접 조회. Vercel 배포 | `node web-server.js` → localhost:5173 |
| `supabase/` | 스키마·RLS SQL, Edge Functions | — |
| `.github/workflows/` | 매일 KST 05:00 수집·적재 | Actions 탭 |
| `docs/` | 현황·결정·할 일·일지 | — |

## 2. 문서 지도와 갱신 트리거
| 문서 | 무엇 | 언제 고치나 |
|---|---|---|
| `docs/STATUS.md` | 지금 상태(덮어쓰기, 6KB 이하) | `/wrap` |
| `docs/buildlog/YYYY-MM.md` | 작업 일지(5단, 최신이 위) | `/wrap` |
| `docs/TASKS.md` | 할 일 `#n` | 작업 시작·종료 |
| `docs/DECISIONS.md` | 결정 `D-n`(행 300자 이내) | 결정 직후 |
| `docs/ARCHITECTURE.md` | 설계 원칙·구조 | 구조 변경 |
| `docs/tasks/T-nn.md` | 큰 작업 계획 | 큰 작업 시작 전 |
| `docs/HANDOFF.md`·`SETUP.md` | 인수인계·새 컴퓨터 | 넘기기 전 |

같은 내용을 두 곳에 쓰지 않는다. 한 곳에 쓰고 가리킨다.

## 3. 새 세션 시작
`/onboard`: `docs/STATUS.md` §1 → `docs/TASKS.md`에서 `#n`을 잡아 `## 진행중`에 → 작업 경로의 하위 `AGENTS.md`(가까운 것이 우선). 끝나면 `/wrap`.

## 4. 검증 명령
- 전체 검사: `npm run check` — JS 문법·JSON·taxonomy 사본만 본다. 동작은 보장 안 함.
- 화면 변경: `node web-server.js` 후 브라우저에서 직접 확인(모바일 폭 포함).
- 수집 변경: `node src/run.js --source=<브랜드id>` 로 `data/out/` 결과 확인.
- 가드 자가 시험: `/harness-check`

명령이 없으면 "검증 명령 없음"으로 보고하고 통과로 세지 않는다.

## 5. 커밋·PR
- `type(scope): 요약 (#n)`. type: feat, fix, test, docs, chore, refactor. 본문에 "확인:"(실행한 명령과 결과).
- 한 커밋·PR에는 한 가지 일.
- 리뷰 지적은 고친다 / `file:line` 근거로 반박한다 / 경미하면 TASKS `## 이월`.
- 지금은 `main`에 바로 커밋한다(1인 프로젝트). push하면 Vercel에 바로 배포되므로 push는 사용자 확인 후.

## 6. 리뷰 규칙 (Code Review Rules)
`/self-review`·`reviewer` 에이전트·외부 리뷰어의 기준. grep이나 명령으로 확인할 수 있게 쓴다.
- 비밀값·토큰·개인정보가 diff에 0건.
- 바뀐 동작에는 테스트나 재현 명령이 있다.
- 디버깅하려고 넣은 출력(`console.log`·`print`)과 주석 처리한 코드 덩어리 0건. 프로그램의 원래 출력은 해당 없음.
- 테스트는 실제 발송·결제·유료 API를 부르지 않는다.
- diff 밖 심볼은 파일을 열어 확인한 뒤에만 지적한다. 취향·이론적 위험은 nit.
- `SUPABASE_SERVICE_KEY`·`getSupabaseAdmin`은 `src/`(로컬·CI)에서만. `web/`에는 anon 키만(`grep -rn SERVICE web/` 0건).
- 새 테이블·컬럼은 `supabase/*.sql`에 남기고 RLS를 켠다(`enable row level security` + 정책).
- 새 쇼핑몰 플랫폼은 브랜드별 코드가 아니라 `src/adapters/` 어댑터로 추가한다.
- 아이콘 등 이미지 에셋을 같은 이름으로 바꾸면 `web/sw.js`의 `CACHE` 버전을 올린다(HTML·JS·JSON은 불필요).
- `taxonomy.json`을 바꾸면 `web/taxonomy.json`에도 복사한다(`npm run check`가 어긋남을 잡는다).

## 7. 멈추고 물어볼 것
아래만 **실행 전에 사용자 승인**. 그 밖의 되돌릴 수 있는 일은 묻지 않고 한다.
- 운영 데이터 삭제·초기화·마이그레이션 (되돌릴 수 없다)
- 실제 결제·발송·외부 공개·운영 배포 (바깥으로 나간다)
- 비밀값·권한·요금제·도메인 변경, 강제 푸시·히스토리 재작성
- 민감 경로 수정: `.github/workflows/**`, `.claude/**`, `supabase/**`, `web/config.js`

민감 경로는 `.claude/harness.json`의 `protectedPaths`와 같게 유지한다(훅이 그 목록으로 확인을 받는다). 바꾼 PR은 본문에 이유를 쓴다.

## 8. 대기는 일이 아니다
- CI·리뷰를 기다리며 턴을 끝내지 않는다. 그 결과에 의존하지 않는 다음 일을 한다.
- "결과 나오면 하겠습니다"로 끝내지 않는다. 다음 일은 예고하지 말고 하고 나서 보고한다.
- 정말 기다려야 하면 무엇을 기다리는지와 확인 명령(예: `gh pr checks <번호>`)을 남긴다. 평소의 3배가 넘게 응답이 없으면 멈춘 것으로 보고 다시 실행한다.
- 사용자 결정 대기는 정당한 정지다. 정할 것, 선택지, 추천을 함께 적는다.

<!-- harness-kit:begin design v0.1.0 -->
## 디자인 규칙

- **정본**: 토큰 값은 토큰 파일(`docs/UI_GUIDE.md` 맨 위에 경로), 규약은 `docs/UI_GUIDE.md`. 값이 충돌하면 토큰 CSS가 정본.
- **금지**: 컴포넌트에 하드코딩 색(`#hex`·`rgb()`·`bg-[#…]`), `transition: all`, 확대 금지 메타. 모션은 `prefers-reduced-motion` 처리와 함께, `transform`·`opacity`만.
- **한국어 본문**: `word-break: keep-all` + `overflow-wrap: anywhere`. 모바일 터치 대상 44px 권장(최소 24px).
- **UI를 바꿨으면**: `/harness-design:ui-lint` 오류 0을 확인하고, web-frontend 팩이 있으면 UI 걷기까지.
- **새 화면·큰 변경**: `design-flow` 순서(시안 → 토큰 → 검증 → 컨펌 → 구현 → 회귀). 색 취향보다 구조 승인이 먼저.
- **승인본**(`docs/design/confirmed/**`)은 고치지 않는다 — 새 날짜 폴더로 박제. 토큰 값 변경은 사용자 승인 + `DECISIONS.md` D-번호.
- 레포에 이미 있는 디자인 시스템을 외부 기준으로 덮어쓰지 않는다.
<!-- harness-kit:end design -->
