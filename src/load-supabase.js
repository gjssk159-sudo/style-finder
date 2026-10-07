// data/out/*.json + brands.json  ->  Supabase (brands, product_group, offer)
// 로컬 load.js(SQLite)와 같은 dedupe 로직을 쓰고, 결과를 Supabase로 올리기만 다름.
//   node src/load-supabase.js              전체
//   node src/load-supabase.js 999humanity  특정 소스만

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { groupItems } from './dedupe.js';
import { getSupabaseAdmin } from './lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'out');
const BATCH = 500;

// 편집샵 전용(자체 미등록) 브랜드는 dedupe.js에서 소스(편집샵) id로 브랜드를 대신하는데,
// 그러면 원래 다른 브랜드였어도 같은 편집샵 id + 우연히 같은 title_norm이면 DB 유니크 키가 겹친다.
// (brand_id, title_norm) 유니크 제약 위반/한 배치 내 중복 upsert 에러를 막기 위해 업로드 전 한 번 더 합침.
function mergeByBrandTitle(groups) {
  const map = new Map();
  for (const g of groups) {
    const key = `${g.brand_id}||${g.title_norm}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...g,
        categories: new Set(g.categories),
        colors: new Set(g.colors),
        sizes: new Set(g.sizes),
        offers: [...g.offers],
      });
      continue;
    }
    if (g.title && g.title.length < existing.title.length) existing.title = g.title;
    for (const c of g.categories) existing.categories.add(c);
    for (const c of g.colors) existing.colors.add(c);
    for (const s of g.sizes) existing.sizes.add(s);
    if (g.min_price != null) existing.min_price = existing.min_price == null ? g.min_price : Math.min(existing.min_price, g.min_price);
    if (g.max_price != null) existing.max_price = existing.max_price == null ? g.max_price : Math.max(existing.max_price, g.max_price);
    if (!existing.image && g.image) existing.image = g.image;
    if (g.in_stock) existing.in_stock = true;
    if (!existing.gender && g.gender) existing.gender = g.gender;
    existing.offers.push(...g.offers);
  }
  return [...map.values()].map((g) => ({ ...g, categories: [...g.categories], colors: [...g.colors], sizes: [...g.sizes] }));
}

// count/upsert가 아닌 일반 select는 기본 1000행 제한이 있어서, 브랜드/소스 하나가 그 이상이면
// 페이지네이션 없이는 뒤가 잘려서 "오래된 데이터"로 오판(=삭제)될 수 있음 -> 끝까지 다 받아옴.
async function selectAll(sb, table, column, value, fields) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(fields).eq(column, value).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function upsertBatched(sb, table, rows, opts, select) {
  let done = 0;
  const returned = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    let query = sb.from(table).upsert(chunk, opts);
    if (select) query = query.select(select);
    const { data, error } = await query;
    if (error) throw new Error(`${table} upsert 실패 (rows ${i}-${i + chunk.length}): ${error.message}`);
    if (select) returned.push(...data);
    done += chunk.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  console.log('');
  return returned;
}

async function main() {
  const sb = getSupabaseAdmin();

  // 1) brands.json -> brands 테이블
  const registry = JSON.parse(readFileSync(join(root, 'brands.json'), 'utf8'));
  const brandRows = registry.sources.map((s) => ({
    id: s.id,
    name: s.name,
    name_en: s.nameEn || null,
    type: s.type,
    instagram: s.instagram || null,
    shop_url: s.shopUrl,
    platform: s.platform,
    discovery: s.discovery || {},
    status: s.status,
    notes: s.notes || null,
  }));
  console.log(`brands.json: ${brandRows.length}개`);
  await upsertBatched(sb, 'brands', brandRows, { onConflict: 'id' });

  // 2) data/out/*.json -> dedupe -> product_group + offer
  const only = process.argv.slice(2);
  const files = readdirSync(outDir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => only.length === 0 || only.includes(f.replace(/\.json$/, '')));

  const items = [];
  for (const f of files) {
    const arr = JSON.parse(readFileSync(join(outDir, f), 'utf8')).filter((it) => it.title);
    items.push(...arr);
  }
  console.log(`\n수집 데이터: ${files.length}개 파일, ${items.length}개 offer`);

  const groups = mergeByBrandTitle(groupItems(items));
  console.log(`중복 제거 후: ${groups.length}개 product_group`);

  const groupRows = groups.map((g) => ({
    brand_id: g.brand_id,
    brand: g.brand,
    title_norm: g.title_norm,
    title: g.title,
    categories: g.categories,
    colors: g.colors,
    sizes: g.sizes,
    gender: g.gender,
    min_price: g.min_price,
    max_price: g.max_price,
    image: g.image,
    in_stock: g.in_stock,
    offer_count: g.offers.length,
    updated_at: new Date().toISOString(),
  }));

  // brand_id는 dedupe.js에서 편집샵 소스 id로 폴백되므로 거의 항상 채워져 있음.
  // (brand_id,title_norm) 유니크 제약상 NULL은 업로드에서 제외.
  const withBrandId = groupRows.filter((g) => g.brand_id);
  const withoutBrandId = groupRows.length - withBrandId.length;
  if (withoutBrandId) console.log(`  (brand_id 없어서 이번엔 스킵: ${withoutBrandId}개 — 편집샵 전용 브랜드)`);

  console.log('\nproduct_group 업로드:');
  const upserted = await upsertBatched(
    sb,
    'product_group',
    withBrandId,
    { onConflict: 'brand_id,title_norm' },
    'id, brand_id, title_norm',
  );

  const idMap = new Map(); // "brand_id||title_norm" -> group id
  for (const row of upserted) idMap.set(`${row.brand_id}||${row.title_norm}`, row.id);

  // 같은 (source_id, external_id)가 두 번 이상 나오면(같은 상품이 카테고리 페이지 여러 곳에 걸쳐
  // 중복 수집된 경우 등) 한 배치 안에서 "ON CONFLICT DO UPDATE cannot affect row a second time" 에러가 남 —
  // product_group의 mergeByBrandTitle과 같은 이유로, 업로드 전에 먼저 하나로 합침.
  const offerRows = [];
  const offerKeys = new Set();
  for (const g of groups) {
    if (!g.brand_id) continue;
    const groupId = idMap.get(`${g.brand_id}||${g.title_norm}`);
    if (!groupId) continue;
    for (const o of g.offers) {
      const key = `${o.source_id}||${o.external_id}`;
      if (offerKeys.has(key)) continue;
      offerKeys.add(key);
      offerRows.push({
        group_id: groupId,
        source_id: o.source_id,
        source_type: o.source_type,
        external_id: o.external_id,
        url: o.url,
        title: o.title,
        price: o.price,
        image: o.image,
        in_stock: o.in_stock,
        colors: o.colors,
        sizes: o.sizes,
        updated_at: new Date().toISOString(),
      });
    }
  }
  console.log(`\noffer 업로드 (${offerRows.length}개):`);
  await upsertBatched(sb, 'offer', offerRows, { onConflict: 'source_id,external_id' });

  // 오래된 데이터 정리: 이번에 다시 안 나온(품절 삭제, URL 변경, 예전 버그로 잘못 올라간 유령 상품 등) 건 삭제.
  // upsert는 추가/갱신만 하고 삭제는 안 하므로, 이 단계가 없으면 옛날 데이터가 영영 안 지워짐.
  console.log('\n오래된 데이터 정리:');
  const freshGroupKeys = new Set(withBrandId.map((g) => `${g.brand_id}||${g.title_norm}`));
  const affectedBrandIds = [...new Set(withBrandId.map((g) => g.brand_id))];
  let staleGroups = 0;
  for (const brandId of affectedBrandIds) {
    const existing = await selectAll(sb, 'product_group', 'brand_id', brandId, 'id,title_norm');
    const staleIds = existing.filter((r) => !freshGroupKeys.has(`${brandId}||${r.title_norm}`)).map((r) => r.id);
    // 이번 수집이 기존의 70%도 안 되면 수집이 중간에 끊긴 것(타임아웃/차단)일 가능성이 커서, 멀쩡한 기존 상품을
    // 지우지 않고 그대로 둔다(실측: CI에서 아임웹 몰들이 일부만/0개 수집돼 있던 상품이 사라지거나 줄어듦).
    if (existing.length >= 20 && staleIds.length > existing.length * 0.3) {
      console.warn(`  ! ${brandId}: 기존 ${existing.length}개 중 ${staleIds.length}개가 이번에 안 나옴 → 수집이 불완전한 걸로 보고 삭제 건너뜀`);
      continue;
    }
    for (let i = 0; i < staleIds.length; i += BATCH) {
      const { error } = await sb.from('product_group').delete().in('id', staleIds.slice(i, i + BATCH));
      if (error) throw new Error('오래된 product_group 삭제 실패: ' + error.message);
    }
    staleGroups += staleIds.length;
  }

  const freshOfferKeys = new Set(offerRows.map((o) => `${o.source_id}||${o.external_id}`));
  const affectedSourceIds = [...new Set(offerRows.map((o) => o.source_id))];
  let staleOffers = 0;
  for (const sourceId of affectedSourceIds) {
    const existing = await selectAll(sb, 'offer', 'source_id', sourceId, 'id,external_id');
    const staleIds = existing.filter((r) => !freshOfferKeys.has(`${sourceId}||${r.external_id}`)).map((r) => r.id);
    if (existing.length >= 20 && staleIds.length > existing.length * 0.3) {
      console.warn(`  ! ${sourceId}: offer ${existing.length}개 중 ${staleIds.length}개가 이번에 안 나옴 → 삭제 건너뜀`);
      continue;
    }
    for (let i = 0; i < staleIds.length; i += BATCH) {
      const { error } = await sb.from('offer').delete().in('id', staleIds.slice(i, i + BATCH));
      if (error) throw new Error('오래된 offer 삭제 실패: ' + error.message);
    }
    staleOffers += staleIds.length;
  }
  console.log(`  product_group ${staleGroups}개, offer ${staleOffers}개 삭제됨`);

  console.log('\n완료.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
