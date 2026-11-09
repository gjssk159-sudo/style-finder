// 최신순을 "홈페이지 등록일"로 바로잡기(#8). 기본은 미리 보기(읽기만) — 실제로 고치려면 --apply (운영 데이터 변경: 사용자 승인 후에만).
// 규칙은 src/lib/listed-at.js. 쇼피파이 등록일은 각 쇼핑몰의 공개 products.json 에서 읽는다.
// 실행: node scripts/repair-listed-at.mjs            (미리 보기)
//       node scripts/repair-listed-at.mjs --apply    (실제 수정, 고치기 전 날짜를 data/backup 에 남김)
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/lib/supabase.js';
import { estimateListedAt } from '../src/lib/listed-at.js';

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

// 쇼피파이 등록일: source_id -> Map(상품 id -> published_at)
// 브랜드는 brands.json + 사이트에서 사용자가 추가한 브랜드(DB brands 표) 둘 다
const fileBrands = Object.values(JSON.parse(readFileSync('brands.json', 'utf8'))).find(Array.isArray);
const { data: dbBrands, error: be } = await sb.from('brands').select('id,platform,shop_url');
if (be) throw new Error(`brands 조회 실패: ${be.message}`);
const shopify = new Map();
for (const b of fileBrands) if (b.platform === 'shopify') shopify.set(b.id, b.shopUrl);
for (const b of dbBrands) if (b.platform === 'shopify' && b.shop_url) shopify.set(b.id, b.shop_url);
const shopifyListed = new Map();
for (const [id, shopUrl] of shopify) {
  const b = { id, shopUrl };
  const m = new Map();
  const base = b.shopUrl.replace(/\/$/, '');
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${base}/products.json?limit=250&page=${page}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) break;
    const ps = (await res.json())?.products ?? [];
    if (!ps.length) break;
    for (const p of ps) m.set(String(p.id), p.published_at || p.created_at || null);
    await new Promise((r) => setTimeout(r, 600));
  }
  shopifyListed.set(b.id, m);
  console.log(`쇼피파이 ${b.id}: 등록일 ${m.size}개`);
}

const groups = await all('product_group', 'id,brand_id,brand,first_seen_at');
const offers = await all('offer', 'group_id,source_id,external_id,image');
const offersBy = new Map();
for (const o of offers) {
  const listed_at = shopifyListed.get(o.source_id)?.get(String(o.external_id)) || null;
  if (!offersBy.has(o.group_id)) offersBy.set(o.group_id, []);
  offersBy.get(o.group_id).push({ ...o, listed_at });
}
const byBrand = new Map();
for (const g of groups) {
  if (!byBrand.has(g.brand_id)) byBrand.set(g.brand_id, []);
  byBrand.get(g.brand_id).push({ key: g.id, offers: offersBy.get(g.id) || [], seen: g.first_seen_at });
}
const next = new Map();
for (const rows of byBrand.values()) for (const [k, v] of estimateListedAt(rows)) next.set(k, v);

const changes = groups.filter((g) => next.has(g.id) && next.get(g.id) !== new Date(g.first_seen_at).toISOString());
console.log(`\n전체 상품 ${groups.length} · 등록일 흔적 있음 ${next.size} · 날짜가 바뀌는 상품 ${changes.length}`);

const top = (getT) => groups.map((g) => ({ ...g, t: getT(g) })).sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : a.id - b.id));
const dist = (list) => {
  const c = {};
  for (const r of list) c[r.brand] = (c[r.brand] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([b, n]) => `${b} ${n}`).join(' · ');
};
const before = top((g) => new Date(g.first_seen_at).toISOString());
const after = top((g) => next.get(g.id) || new Date(g.first_seen_at).toISOString());
console.log('\n[지금] 최신순 맨 위 100개 브랜드:', dist(before.slice(0, 100)));
console.log('[바꾼 뒤] 최신순 맨 위 100개 브랜드:', dist(after.slice(0, 100)));
console.log(`[바꾼 뒤] 맨 위 100개에 나오는 브랜드 수: ${new Set(after.slice(0, 100).map((r) => r.brand)).size}`);
console.log('\n[바꾼 뒤] 맨 위 40개:');
for (const r of after.slice(0, 40)) console.log(' ', r.t.slice(0, 10), r.brand);

if (!apply) { console.log('\n(미리 보기 — 실제로 고치지 않았습니다. 고치려면 --apply)'); process.exit(0); }
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync('data/backup', { recursive: true });
const backup = `data/backup/listed-at-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backup, JSON.stringify(changes.map((g) => ({ id: g.id, from: g.first_seen_at, to: next.get(g.id) })), null, 1));
console.log(`백업: ${backup} (${changes.length}개의 원래 날짜)`);
let done = 0;
for (const g of changes) {
  const { error } = await sb.from('product_group').update({ first_seen_at: next.get(g.id) }).eq('id', g.id);
  if (error) throw new Error(`수정 실패 id=${g.id}: ${error.message}`);
  if (++done % 500 === 0) process.stdout.write(`\r  ${done}/${changes.length}`);
}
console.log(`\n바로잡음: ${done}개`);
