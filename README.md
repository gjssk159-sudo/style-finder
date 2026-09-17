# style-finder (가칭)

여러 브랜드/편집샵의 판매 상품을 한 곳에 모아서, "셔츠" 처럼 검색하면
각 브랜드에서 파는 셔츠가 쫙 리스트업되는 서비스.

작은 국내 인디 브랜드(팔로워 1만 미만) 위주. 대부분 자사몰 D2C.

---

## 전체 구조

```
brands.json        브랜드/편집샵 목록 + 각각의 수집 설정 (레지스트리)
taxonomy.json      검색 카테고리 사전 (셔츠/후드집업/... + 키워드)

pipeline/
  fetch            브랜드별 상품 목록/상세를 원본 그대로 수집  → raw_product
  normalize        원본을 공통 형식으로 변환 + taxonomy로 카테고리 분류
  dedupe           같은 상품(자사몰+편집샵 중복)을 하나로 묶기
  store            Supabase(Postgres)에 저장

web/               검색 화면 (나중에)
```

수집은 **브랜드마다 코드를 짜는 게 아니라 플랫폼별 어댑터**로 처리한다.
`brands.json`의 `platform` 값이 이미 만든 어댑터(`cafe24`, `shopify`)면
항목만 추가하면 바로 수집된다. 새 플랫폼일 때만 어댑터를 새로 만든다.

---

## 어댑터

### shopify
- `GET {shopUrl}/products.json?limit=250&page=N` 반복 → 전 상품 JSON
- 필드: `title`, `handle`, `vendor`(=브랜드), `product_type`, `tags`, `variants[].price`, `images[].src`
- 상품 URL: `{shopUrl}/products/{handle}`
- 파일럿 대상: 산산기어

### cafe24
- `GET {shopUrl}/sitemap.xml` → `/product/{slug}/{id}/` 형태의 상품 URL 전부 수집
  (스킨/디자인이 달라도 sitemap은 동일 → 안정적)
- 각 상품 URL fetch → 우선순위대로 파싱:
  1. `<script type="application/ld+json">` 의 `Product` 스키마 (name, image, offers.price, brand)
  2. Open Graph 태그 (`og:title`, `og:image`, `product:price:amount`)
  3. Cafe24 표준 마크업 (`.xans-product-detail`, `#span_product_price_text` 등)
- 파일럿 대상: 코이세이오, 999휴머니티, 사파리스팟, 엑슬림, 더엑스샵

### custom (웍스아웃)
- 브라우저 개발자도구 Network 탭에서 상품 목록 API(JSON) 찾아서 1회성 어댑터 작성
- 우선순위 낮음

---

## 공통 상품 형식 (normalize 결과)

```jsonc
{
  "source_id": "coyseio",          // brands.json의 id
  "source_type": "brand",          // brand | select_shop
  "brand": "코이세이오",            // 편집샵이면 상품의 실제 브랜드
  "external_id": "1056",           // 원본 사이트 상품 번호
  "url": "https://coyseio.com/product/.../1056/",
  "title": "어드벤처 소프트 후디 터콰이즈",
  "price": 89000,
  "currency": "KRW",
  "images": ["https://..."],
  "categories": ["hoodie"],        // taxonomy 분류 결과 (복수 가능)
  "in_stock": true,
  "raw_category": "women/hoodie",   // 원본 카테고리 텍스트 (분류 근거)
  "fetched_at": "2026-09-10T..."
}
```

## 중복 제거 (dedupe)

같은 상품이 자사몰 + 편집샵에 동시 등장할 때 하나로 묶는다.
매칭 신호 (강 → 약):

1. `브랜드 + 정규화된 상품명` (색상/시즌/공백/특수문자 제거 후 비교)
2. 대표 이미지 perceptual hash (pHash) 근접
3. 가격 근접 (±5%)

묶은 결과는 `product_group` 1개 + 여러 `offer`(판매처별 링크/가격) 로 저장.
→ 검색 결과엔 상품 1개로 보이고, 클릭하면 판매처 목록.

---

## 진행 상황 (2026-09-11)

- [x] Node.js 24 설치, 프로젝트 스캐폴드
- [x] `shopify` 어댑터, `cafe24` 어댑터 (sitemap + 카테고리크롤링 폴백)
- [x] 5개 브랜드(파일럿) 전체 수집 완료 — 2,921 offer → 1,619 product_group
- [x] 동시 요청 처리(`lib/concurrency.js`) — 엑슬림 971개 기준 11분+ → 65초 (~10배)
- [x] taxonomy 분류기, dedupe(색상별 분리상품 묶기 + 색상 표준화), SQLite 저장, 검색 웹 UI(`localhost:5173`)
- [x] 자연어 질의("후드집업 찾아줘") 파싱, 색상/사이즈 필터
- [x] **URL 자동 플랫폼 판별기**(`src/detect.js`) + **브랜드 등록 CLI**(`src/add-brand.js`) — 파일럿 8개 중 6개를 사람 개입 없이 정확히 재판별함
- [ ] `thexshop`/`worksout`(편집샵): 상품별 실제 브랜드 라벨 추출
- [ ] Cafe24 사이즈 추출 (지금은 Shopify만 사이즈 있음)
- [ ] 로그인 + 개인 폴더(브랜드 구독) + Supabase 이전 — RSS 리더 구조: 수집은 공용, 검색은 폴더별
- [ ] GitHub Actions 크론(자동 정기 수집)

### 실행 방법

```bash
# PATH에 node 없으면: $env:Path = "C:\Program Files\nodejs;" + $env:Path
node src/detect.js <URL>                    # 플랫폼만 판별 (등록은 안 함)
node src/add-brand.js <URL> [이름] [인스타]   # 판별 + brands.json에 자동 등록
node src/run.js                              # status:"ready" 전부 수집
node src/run.js --source=999humanity         # 하나만
node src/reclassify.js                       # taxonomy만 고쳤을 때 재수집 없이 재분류
node src/load.js                             # data/out/*.json -> SQLite
node src/server.js                           # http://localhost:5173
```

---

## 브랜드 추가하는 법

`brands.json`의 `sources` 배열에 항목 추가:

```jsonc
{
  "id": "새브랜드id",
  "name": "브랜드명",
  "type": "brand",
  "instagram": "핸들",
  "shopUrl": "https://...",
  "platform": "cafe24",          // or "shopify"
  "discovery": { "method": "cafe24_sitemap", "path": "/sitemap.xml" },
  "status": "ready"
}
```

`platform`이 `cafe24`/`shopify`면 그대로 다음 수집에 포함됨.
플랫폼을 모르면 `status: "unknown"` 으로 넣어두면 나중에 일괄 판별.
