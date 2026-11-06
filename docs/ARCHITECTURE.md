# 아키텍처
> 설계 원칙과 구조. 상한 10KB. 구조가 바뀌면 고친다. 왜 그렇게 정했는지는 `docs/DECISIONS.md`의 `D-n`을 가리킨다.
> 최종 확인: 2026-11-06

## 0. 설계 원칙 — 깨면 안 되는 것
1. service 키(`SUPABASE_SERVICE_KEY`)는 `src/`(로컬·CI)와 Edge Function 안에서만 쓴다. `web/`에는 anon 키만 둔다(`grep -rn SERVICE web/` 0건).
2. 사용자 데이터(폴더·담은 브랜드·Q&A)는 RLS로 지킨다. 새 테이블은 `supabase/*.sql`에 남기고 RLS를 켠다.
3. 수집은 브랜드별 코드가 아니라 플랫폼별 어댑터(`src/adapters/`)로 한다. 지원 플랫폼이면 `brands.json`(실제로는 Supabase `brands` 테이블) 항목만 추가한다.
4. 화면은 빌드 없는 HTML/JS다. 번들러·프레임워크를 넣지 않는다.
5. 카테고리 사전은 `taxonomy.json` 하나가 정본이고, `web/taxonomy.json`은 그 사본이다(`npm run check`가 어긋남을 잡는다).

## 1. 구조 한눈에
| 구성요소 | 어디 | 하는 일 |
|---|---|---|
| 수집기 | `src/run.js`, `src/adapters/`(cafe24·imweb·shopify·sixshop) | 브랜드 자사몰에서 상품을 긁어 `data/out/`에 저장 |
| 분류·중복 | `src/reclassify.js`, `src/dedupe.js`, `taxonomy.json` | 카테고리·색상 붙이기, 같은 상품 묶기 |
| 적재 | `src/load-supabase.js`, `src/warm-thumbs.js` | Supabase에 올리기, 썸네일 미리 데우기 |
| 브랜드 등록 | `src/add-brand.js`, `src/detect.js`, `src/process-pending.js` | URL로 플랫폼 판별·등록 |
| DB | Supabase Postgres(`supabase/schema.sql`, `qna.sql`, `first-seen.sql`, `qna-notify.sql`) | `brands`, `product_group`, `offer`, `folders`, `user_brands`, `qna_posts` |
| Edge Functions | `supabase/functions/register-brand`, `notify-qna` | 화면에서 브랜드 등록 → 즉시 수집 트리거, Q&A 알림 |
| 화면 | `web/`(`index.html`·`app.js`·`shell.js`·`sw.js`) | PWA. anon 키로 Supabase 직접 조회. Vercel 배포 |
| 자동 실행 | `.github/workflows/collect.yml`, `collect-single.yml` | 매일 KST 05:00 전체 수집, 새 브랜드 즉시 수집 |

`src/server.js`·`src/db.js`·`data/style-finder.db`는 예전 로컬 검색 서버(SQLite)다. 지금 운영 화면은 쓰지 않는다.

## 2. 데이터 흐름
- **매일 수집**: Actions `collect.yml` → `prepare`(대기 브랜드 판별 `process-pending.js`, `brands` 테이블 → `brands.json` 동기화, 12개씩 샤드) → `collect`(샤드별 병렬 `run.js`) → `finalize`(합치기 → `reclassify.js` → `load-supabase.js` → `warm-thumbs.js`).
- **브랜드 등록**: 화면 + 버튼 → Edge Function `register-brand`(플랫폼 판별, `brands`에 기록) → `GH_DISPATCH_TOKEN`으로 `collect-single.yml` 실행 → 1~2분 뒤 검색에 보임.
- **조회**: 화면이 로그인 후 `folders`·`user_brands`로 내 폴더 브랜드를 정하고 `product_group`을 조회.
- **Q&A**: `qna_posts`에 글 → DB 트리거(`qna-notify.sql`) → `notify-qna` → 웹훅·텔레그램 알림.

## 3. 외부 의존
| 서비스·API | 무엇에 쓰나 | 없으면 |
|---|---|---|
| Supabase | DB·로그인·RLS·Edge Functions | 화면 전체가 안 됨 |
| Vercel | `web/` 호스팅(`main` push 시 배포) | 사이트 접속 불가 |
| GitHub Actions | 매일 수집, 즉시 수집 | 상품이 갱신 안 됨, 새 브랜드가 다음 날까지 안 보임 |
| Playwright(크로미움) | 자바스크립트로 그리는 쇼핑몰 수집 | 일부 브랜드 수집 실패 |
| Telegram·Discord/Slack 웹훅 | Q&A 알림 | 알림만 안 옴 |

## 4. 바꿀 때 주의
- `taxonomy.json`을 바꾸면 `web/taxonomy.json`에도 복사한다.
- 아이콘 같은 이미지를 같은 이름으로 바꾸면 `web/sw.js`의 `CACHE` 버전을 올린다.
- `supabase/**`, `.github/workflows/**`, `web/config.js`는 민감 경로라 고치기 전에 사용자 확인을 받는다(AGENTS.md §7).
- `brands.json`은 CI가 Supabase `brands` 테이블에서 다시 만든다. 브랜드 정본은 테이블이다.
