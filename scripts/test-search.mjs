// 검색 시험(#6). 사이트의 검색어 해석(web/taxonomy-client.js)을 그대로 불러와, 실제 수집 상품(data/out)에
// 사이트와 같은 방식(분류 일치 OR 상품명·브랜드에 표기 포함)으로 검색을 흉내 낸다. 데이터베이스에는 접속하지 않는다.
// 실행: node scripts/test-search.mjs   (npm run test:search)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { classifyItem } from '../src/lib/taxonomy.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tax = JSON.parse(readFileSync(join(root, 'web', 'taxonomy.json'), 'utf8'));
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ json: async () => tax }), console };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'web', 'taxonomy-client.js'), 'utf8'), ctx);
const T = ctx.window.StyleFinderTaxonomy;
await T.loadTaxonomy();

// 상품(가볍게 10개 브랜드가 아니라 전부)
const products = [];
const outDir = join(root, 'data', 'out');
if (!existsSync(outDir)) { console.log('data/out 이 없어 검색 시험을 건너뜀(수집 데이터 필요)'); process.exit(0); }
for (const f of readdirSync(outDir).filter((f) => f.endsWith('.json'))) for (const it of JSON.parse(readFileSync(join(outDir, f), 'utf8'))) products.push({ brand: it.brand || f, title: String(it.title || ''), cats: classifyItem(it.title, it.raw_category) });

// app.js buildQuery 와 같은 규칙: 검색어마다 (분류 겹침 OR 상품명/브랜드에 표기 포함) 을 모두 만족
function search(q) {
  const { terms } = T.parseQuery(q);
  return products.filter((p) => terms.every((t) => {
    if (t.cats.length && p.cats.some((c) => t.cats.includes(c))) return true;
    const hay = (p.title + ' ' + p.brand).toLowerCase();
    return t.variants.some((v) => hay.includes(String(v).toLowerCase()));
  }));
}

const has = (re) => (p) => re.test(p.title);
const BALA = /balaclava|발라클라바|바라클라바/i;
// [검색어, 확인할 것, 설명]
const CASES = [
  ['바라클라바', (r) => r.length > 0 && r.every(has(BALA)), '한글 "바라클라바"로 영어 Balaclava 상품이 나온다'],
  ['발라클라바', (r) => r.length > 0 && r.every(has(BALA)), '한글 "발라클라바"도 같은 결과'],
  ['balaclava', (r) => r.length > 0 && r.every(has(BALA)), '영어 balaclava 는 바라클라바만(비니 전체가 아님)'],
  ['balacla', (r) => r.length > 0 && r.every(has(BALA)), '앞부분만 쳐도 바라클라바'],
  ['비니', (r) => r.length > 20 && r.filter(has(/beanie|비니/i)).length / r.length > 0.5, '"비니"는 비니 분류 전체'],
  ['청바지', (r) => r.length > 50, '청바지 → 데님 상품'],
  ['jeans', (r) => r.length > 50, 'jeans → 데님 상품'],
  ['가디건', (r) => r.length > 50 && r.filter(has(/cardigan|가디건|카디건/i)).length / r.length > 0.5, '가디건 → 카디건'],
  ['cardigan', (r) => r.length > 50, 'cardigan → 카디건'],
  ['블랙 후드', (r) => r.length > 0, '색 + 종류'],
  ['크롭', (r) => r.length >= 100 && r.filter(has(/crop|크롭/i)).length / r.length > 0.9, '한글 "크롭"으로 영어 crop 상품'],
  ['와이드 팬츠', (r) => r.length >= 50, '한글 "와이드 팬츠"'],
  ['터틀넥', (r) => r.length >= 30 && r.every(has(/turtle\s*neck|터틀넥|폴라/i)), '"터틀넥"은 터틀넥만(니트 전체가 아님)'],
  ['부츠컷', (r) => r.length >= 30 && r.every(has(/boot\s*s?\s*cut|부츠\s*컷/i)), '"부츠컷"은 부츠컷 바지만(바지 전체가 아님)'],
  ['bootcut', (r) => r.length >= 30 && r.every(has(/boot\s*s?\s*cut|부츠\s*컷/i)), '"bootcut"도 부츠컷 바지만'],
  ['리본', (r) => r.length >= 50 && r.every(has(/ribbon|리본/i)), '한글 "리본"으로 ribbon'],
  ['레이스', (r) => !r.some(has(/necklace/i)), '레이스 검색에 목걸이(necklace)가 섞이지 않음'],
];

const before = (q) => search(q).length;
let fail = 0;
for (const [q, ok, why] of CASES) {
  const r = search(q);
  const pass = ok(r);
  if (!pass) fail++;
  const sample = r.slice(0, 3).map((p) => p.title.slice(0, 28)).join(' / ');
  console.log(`${pass ? '통과' : '실패'} ${why} — "${q}" ${r.length}개${sample ? ' 예: ' + sample : ''}`);
}
console.log(fail ? `실패 ${fail}건 / ${CASES.length}` : `모두 통과 ${CASES.length}건`);
process.exit(fail ? 1 : 0);
