// taxonomy.json을 고친 뒤, 네트워크 재수집 없이 data/out/*.json의 categories만 다시 계산.
//   node src/reclassify.js
// (title/raw_category/description은 이미 저장돼 있으니 분류만 재실행하면 됨)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyItem } from './lib/taxonomy.js';
import { classifyGender } from './lib/gender.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'out');

for (const f of readdirSync(outDir).filter((f) => f.endsWith('.json'))) {
  const path = join(outDir, f);
  const items = JSON.parse(readFileSync(path, 'utf8'));
  let changed = 0;
  for (const it of items) {
    const next = classifyItem(it.title, it.raw_category);
    const nextGender = classifyGender(it.title, it.raw_category);
    if (JSON.stringify(next) !== JSON.stringify(it.categories) || nextGender !== it.gender) changed++;
    it.categories = next;
    it.gender = nextGender;
  }
  writeFileSync(path, JSON.stringify(items, null, 2));
  console.log(`${f}: ${items.length}개 중 ${changed}개 분류 변경`);
}
