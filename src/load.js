// data/out/*.json  ->  dedupe  ->  SQLite (product_group + offer)
//   node src/load.js            # data/out 의 모든 소스
//   node src/load.js 999humanity safarispot   # 특정 소스만

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { groupItems } from './dedupe.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'out');

const only = process.argv.slice(2);
const files = readdirSync(outDir)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => only.length === 0 || only.includes(f.replace(/\.json$/, '')));

if (files.length === 0) {
  console.error('data/out 에 불러올 JSON이 없음. 먼저 `node src/run.js` 실행.');
  process.exit(1);
}

const items = [];
let droppedNoTitle = 0;
for (const f of files) {
  const arr = JSON.parse(readFileSync(join(outDir, f), 'utf8'));
  // title 없는 항목은 표시도 dedupe 키도 못 만드니 걸러냄
  // (헤드리스 브라우저 어댑터에서 개별 페이지 렌더링 실패 시 가끔 나옴)
  const clean = arr.filter((it) => it.title);
  droppedNoTitle += arr.length - clean.length;
  items.push(...clean);
  console.log(`  + ${f}: ${clean.length}`);
}
if (droppedNoTitle) console.log(`  (제목 없어서 제외: ${droppedNoTitle}개)`);

const groups = groupItems(items);
console.log(`\n${items.length} offers -> ${groups.length} product groups`);

const db = openDb();
const now = new Date().toISOString();

const upsertGroup = db.prepare(`
  INSERT INTO product_group (brand, title_norm, title, categories, colors, sizes, min_price, max_price, image, in_stock, offer_count, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (brand, title_norm) DO UPDATE SET
    title=excluded.title, categories=excluded.categories, colors=excluded.colors, sizes=excluded.sizes,
    min_price=excluded.min_price, max_price=excluded.max_price, image=excluded.image, in_stock=excluded.in_stock,
    offer_count=excluded.offer_count, updated_at=excluded.updated_at
`);
const getGroupId = db.prepare(`SELECT id FROM product_group WHERE brand=? AND title_norm=?`);
const upsertOffer = db.prepare(`
  INSERT INTO offer (group_id, source_id, source_type, external_id, url, title, price, image, in_stock, colors, sizes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source_id, external_id) DO UPDATE SET
    group_id=excluded.group_id, url=excluded.url, title=excluded.title, price=excluded.price,
    image=excluded.image, in_stock=excluded.in_stock, colors=excluded.colors, sizes=excluded.sizes,
    updated_at=excluded.updated_at
`);

db.exec('BEGIN');
for (const g of groups) {
  upsertGroup.run(
    g.brand, g.title_norm, g.title, JSON.stringify(g.categories),
    JSON.stringify(g.colors), JSON.stringify(g.sizes),
    g.min_price, g.max_price, g.image, g.in_stock ? 1 : 0, g.offers.length, now
  );
  const { id } = getGroupId.get(g.brand, g.title_norm);
  for (const o of g.offers) {
    upsertOffer.run(
      id, o.source_id, o.source_type, o.external_id, o.url, o.title,
      o.price, o.image, o.in_stock ? 1 : 0,
      JSON.stringify(o.colors || []), JSON.stringify(o.sizes || []), now
    );
  }
}
db.exec('COMMIT');

const gc = db.prepare('SELECT COUNT(*) n FROM product_group').get().n;
const oc = db.prepare('SELECT COUNT(*) n FROM offer').get().n;
const byCat = db.prepare(`SELECT categories FROM product_group`).all();
const catCount = {};
for (const r of byCat) for (const c of JSON.parse(r.categories)) catCount[c] = (catCount[c] || 0) + 1;

console.log(`\nDB: ${gc} groups, ${oc} offers`);
console.log('카테고리별 그룹 수:', catCount);
db.close();
