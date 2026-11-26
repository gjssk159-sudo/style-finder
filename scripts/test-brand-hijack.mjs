// 가짜 브랜드가 진짜 브랜드 상품을 가로채지 못하는지 시험(#21).
// 실측: 이상한 주소 "fab.eur"를 등록하자 이름(FAB EUR)이 같은 진짜 fabeur 자사몰 상품 145개가 그 가짜 브랜드 밑으로 붙었다.
// 데이터베이스·쇼핑몰에는 접속하지 않는다. 실행: node scripts/test-brand-hijack.mjs (npm run test:brand-hijack)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupItems } from '../src/dedupe.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'lib', 'brand-alias.js'), 'utf8');
// 이름이 겹치는 상황을 흉내: 자사몰 상품의 브랜드 표기가 이미 등록된 다른 브랜드 이름과 같다
const other = JSON.parse(readFileSync(join(root, 'brands.json'), 'utf8')).sources.find((s) => s.type === 'brand' && s.status === 'ready' && s.id !== 'fabeur');
const item = (n) => ({ source_id: 'fabeur', source_type: 'brand', external_id: String(n), title: 'Wool coat ' + n, brand: other.name, price: 100000, images: [], in_stock: true, categories: ['coat'] });
const groups = groupItems([item(1), item(2)]);
const ids = [...new Set((Array.isArray(groups) ? groups : [...groups.values()]).map((g) => g.brand_id))];
const results = [
  ['자사몰 상품은 이름이 비슷한 다른 브랜드가 아니라 그 몰 자신의 브랜드로 붙는다', JSON.stringify(ids) === '["fabeur"]', JSON.stringify(ids)],
  ['판별 안 된(ready가 아닌) 브랜드는 별칭 사전에 넣지 않는다', /if \(s\.status && s\.status !== 'ready'\) continue;/.test(src), ''],
];
for (const [name, ok, extra] of results) console.log(`${ok ? '통과' : '실패'} ${name}${extra ? ' — ' + extra : ''}`);
const fails = results.filter((r) => !r[1]).length;
console.log(fails ? `실패 ${fails}건` : `모두 통과 ${results.length}건`);
process.exitCode = fails ? 1 : 0;
