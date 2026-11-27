// 최신순 바로잡기(#20, 2026-11-27): 예전 규칙으로 "임의 날짜"가 들어간 상품을 "등록일 모름"(최신순 맨 아래)으로 옮긴다.
//
// 대상: 홈페이지 등록 흔적이 없는 상품(사진 주소에 등록 달·시각이 없음) 중에서
//       브랜드를 처음 수집할 때부터 있던 상품 = 처음 본 시각이 "브랜드 등록 시각(또는 최신순 도입일 11-09) + 2일" 이전.
//       예전엔 이런 상품을 지난 90일에 임의로 흩어 둬서 옛 상품이 최신순 위쪽에 섞였다.
// 제외: 쇼피파이 브랜드(매일 수집 때 홈페이지 등록 일시로 다시 정해짐), 흔적 있는 상품(매일 수집 때 다시 정해짐),
//       그 뒤에 새로 발견된 상품(발견 시각이 곧 등록 시각에 가까움), 이미 "등록일 모름"인 상품.
//
// 실행: node src/fix-unknown-listed.js            (미리 보기: 바꾸지 않고 개수만)
//       node src/fix-unknown-listed.js --apply    (백업 파일을 먼저 쓰고 바꿈: data/backup/first-seen-YYYYMMDD-HHMM.json)
import { mkdirSync, writeFileSync } from 'node:fs';
import { getSupabaseAdmin } from './lib/supabase.js';
import { hintOf } from './lib/listed-at.js';
import { UNKNOWN_AT, isUnknownAt, numOf } from './lib/first-seen.js';

const APPLY = process.argv.includes('--apply');
const DAY = 24 * 60 * 60 * 1000;
const RULE_START = Date.parse('2026-11-09T00:00:00Z'); // 최신순 기준(first_seen_at) 도입·일괄 채움 다음 날
const sb = getSupabaseAdmin();

async function all(table, fields, filter) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(fields).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const brands = await all('brands', 'id,name,platform,type,created_at');
const changes = [];
const report = [];
for (const b of brands) {
  const platform = b.platform || b.type;
  if (platform === 'shopify') continue;
  const groups = await all('product_group', 'id,first_seen_at,image', (q) => q.eq('brand_id', b.id));
  if (!groups.length) continue;
  const offers = await all('offer', 'group_id,image,external_id', (q) => q.eq('source_id', b.id)); // 브랜드 자사몰 판매처(적재 프로그램과 같은 조회)
  const byGroup = new Map();
  for (const o of offers) { if (!byGroup.has(o.group_id)) byGroup.set(o.group_id, []); byGroup.get(o.group_id).push(o); }
  const limit = Math.max(Date.parse(b.created_at) || 0, RULE_START) + 2 * DAY;
  const targets = [];
  for (const g of groups) {
    if (isUnknownAt(g.first_seen_at)) continue;
    if (Date.parse(g.first_seen_at) > limit) continue; // 그 뒤에 새로 발견된 상품
    const os = byGroup.get(g.id) || [];
    const hinted = [{ image: g.image }, ...os].some((o) => hintOf(o));
    if (hinted) continue;
    const num = Math.max(-1, ...os.map((o) => numOf(o.external_id) ?? -1));
    targets.push({ id: g.id, from: g.first_seen_at, num });
  }
  if (!targets.length) continue;
  // 맨 아래 묶음 안에서는 번호가 클수록 위
  targets.sort((x, y) => y.num - x.num).forEach((t, i) => { t.to = new Date(UNKNOWN_AT + (targets.length - i) * 1000).toISOString(); });
  changes.push(...targets);
  report.push(`${b.name}: ${targets.length}개 (전체 ${groups.length}개)`);
}

console.log(report.join('\n') || '바꿀 상품 없음');
console.log(`\n합계: ${changes.length}개를 "등록일 모름"(최신순 맨 아래)으로`);
if (!APPLY) { console.log('미리 보기만 했습니다. 실제로 바꾸려면 --apply'); process.exit(0); }

mkdirSync('data/backup', { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
const file = `data/backup/first-seen-${stamp}.json`;
writeFileSync(file, JSON.stringify(changes.map(({ id, from }) => ({ id, first_seen_at: from }))));
console.log(`백업: ${file} (${changes.length}개)`);
let done = 0;
for (const c of changes) {
  const { error } = await sb.from('product_group').update({ first_seen_at: c.to }).eq('id', c.id);
  if (error) throw new Error(`바꾸기 실패(id ${c.id}): ${error.message}`);
  if (++done % 500 === 0) console.log(`  ${done}/${changes.length}`);
}
console.log(`완료: ${done}개`);
