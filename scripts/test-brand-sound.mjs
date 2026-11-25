// 한글 브랜드 검색 시험(#19): "사파리스팟"처럼 한글로 쳐도 영어 이름 브랜드(SAFARISPOT)가 나오고,
// 흔한 낱말(코트·블랙 등)이 엉뚱한 브랜드로 이어지지 않는지 본다. 데이터베이스에는 접속하지 않는다.
// 실행: node scripts/test-brand-sound.mjs   (npm run test:brand-sound)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ json: async () => ({}) }), console };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'web', 'taxonomy-client.js'), 'utf8'), ctx);
const T = ctx.window.StyleFinderTaxonomy;
const brands = JSON.parse(readFileSync(join(root, 'brands.json'), 'utf8'));
const names = (Array.isArray(brands) ? brands : brands.brands || Object.values(brands)).map((b) => b.name).filter(Boolean);
names.push('SAFARISPOT', 'MISEKISEOUL', 'STUSSY', 'POLYTERU', 'BORDR', 'XLIM');

const CASES = [
  ['사파리스팟', ['SAFARISPOT']],
  ['미세키서울', ['MISEKISEOUL']],
  ['스투시', ['STUSSY']],
  ['폴리테루', ['POLYTERU']], // 자음은 같아도 마디 수가 다른 BORDR은 아님
  ['엑슬림', ['XLIM']],
  ['코트', []], ['블랙', []], ['니트', []], ['셔츠', []], ['후드집업', []], ['가방', []],
];
let fail = 0;
for (const [q, want] of CASES) {
  const got = [...new Set(T.brandsBySound(q, names))];
  const ok = JSON.stringify(got.sort()) === JSON.stringify([...want].sort());
  if (!ok) fail++;
  console.log(`${ok ? '통과' : '실패'} "${q}" → ${JSON.stringify(got)}`);
}
console.log(fail ? `실패 ${fail}건 / ${CASES.length}` : `모두 통과 ${CASES.length}건`);
process.exit(fail ? 1 : 0);
