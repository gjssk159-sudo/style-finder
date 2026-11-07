// 최신순 날짜 바로잡기(#7). 기본은 "미리 보기"(읽기만) — 실제로 고치려면 --apply (운영 데이터 변경: 사용자 승인 후에만).
// 규칙(src/lib/first-seen.js monotonicRepair): 같은 쇼핑몰 안에서 번호가 작은(옛) 상품이 번호가 큰 상품보다 늦은 날짜면
//   그 날짜를 "자기보다 큰 번호들 중 가장 이른 날짜"로 앞당긴다. 앞당기기만 하고, 진짜 신상품(가장 큰 번호들)은 그대로.
// 실행: node scripts/repair-first-seen.mjs            (미리 보기)
//       node scripts/repair-first-seen.mjs --apply    (실제 수정)
import { getSupabaseAdmin } from '../src/lib/supabase.js';
import { monotonicRepair, numOf } from '../src/lib/first-seen.js';

const apply = process.argv.includes('--apply');
const sb = getSupabaseAdmin();
async function all(table, fields) {
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from(table).select(fields).order('id').range(f, f + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
const groups = await all('product_group', 'id,brand,first_seen_at');
const offers = await all('offer', 'group_id,source_id,external_id');
const gById = new Map(groups.map((g) => [g.id, g]));
// 상품(그룹)마다 대표 번호 = 그 그룹 offer 중 가장 큰 숫자 번호(같은 쇼핑몰 기준)
const rep = new Map();
for (const o of offers) {
  const n = numOf(o.external_id);
  const g = gById.get(o.group_id);
  if (n == null || !g) continue;
  const k = `${o.group_id}||${o.source_id}`;
  if (!rep.has(k) || rep.get(k).num < n) rep.set(k, { id: o.group_id, source_id: o.source_id, num: n, first_seen_at: g.first_seen_at });
}
const fixes = new Map();
for (const f of monotonicRepair([...rep.values()])) {
  const prev = fixes.get(f.id);
  if (!prev || f.to < prev.to) fixes.set(f.id, f); // 여러 쇼핑몰에 걸친 상품은 가장 이른 날짜
}
const byBrand = {};
for (const f of fixes.values()) { const b = gById.get(f.id).brand; byBrand[b] = (byBrand[b] || 0) + 1; }
console.log(`전체 상품 ${groups.length} · 바로잡을 상품 ${fixes.size}개`);
console.log('브랜드별:', Object.entries(byBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${n}`).join(' · '));
const ex = [...fixes.values()].slice(0, 5).map((f) => `${gById.get(f.id).brand} ${f.from.slice(0, 16)} → ${f.to.slice(0, 16)}`);
console.log('예:', ex.join(' | '));

// 바로잡은 뒤 최신순 맨 위 200개 브랜드 분포(미리 계산)
const after = groups.map((g) => ({ brand: g.brand, t: (fixes.get(g.id) || {}).to || g.first_seen_at, id: g.id }))
  .sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : b.id - a.id)).slice(0, 200);
const cnt = {};
for (const r of after) cnt[r.brand] = (cnt[r.brand] || 0) + 1;
console.log('바로잡은 뒤 최신순 맨 위 200개:', Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([b, n]) => `${b} ${n}`).join(' · '));

if (!apply) { console.log('\n(미리 보기 — 실제로 고치지 않았습니다. 고치려면 --apply)'); process.exit(0); }
// 되돌릴 수 있게 고치기 전 날짜를 먼저 파일로 남긴다(되돌리기: 이 파일의 from 값으로 다시 update)
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync('data/backup', { recursive: true });
const backup = `data/backup/first-seen-before-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backup, JSON.stringify([...fixes.values()], null, 1));
console.log(`백업: ${backup} (${fixes.size}개의 원래 날짜)`);
let done = 0;
for (const f of fixes.values()) {
  const { error } = await sb.from('product_group').update({ first_seen_at: f.to }).eq('id', f.id);
  if (error) throw new Error(`수정 실패 id=${f.id}: ${error.message}`);
  done++;
  if (done % 200 === 0) process.stdout.write(`\r  ${done}/${fixes.size}`);
}
console.log(`\n바로잡음: ${done}개`);
