// 여러 브랜드를 한 번에 등록 (URL을 이미 알고 있는 상태에서 판별+등록만 일괄 처리).
//   node src/bulk-add.js <입력.json>
// 입력 형식: [{ "instagram": "handle", "shopUrl": "https://...", "name": "표시이름"(optional), "type": "brand"|"select_shop"(optional) }]
// detectPlatform을 동시에 여러 개 돌리고, 끝나면 brands.json에 한 번에 반영.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { detectPlatform } from './detect.js';
import { mapPool } from './lib/concurrency.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'brands.json');

function slugify(hostname) {
  return hostname
    .replace(/^www\./, '')
    .replace(/\.(com|co\.kr|kr|link|net|store|shop)$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
}

export async function bulkAdd(entries, { concurrency = 8 } = {}) {
  const results = await mapPool(
    entries,
    async (e) => {
      try {
        const r = await detectPlatform(e.shopUrl);
        return { ...e, ...r };
      } catch (err) {
        return { ...e, status: 'error', reason: err.message };
      }
    },
    concurrency
  );

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  let added = 0;
  let updated = 0;

  for (const r of results) {
    if (r.status === 'error' && !r.shopUrl) continue;
    const shopUrl = r.shopUrl || null;
    if (!shopUrl) continue;
    const id = slugify(new URL(shopUrl).hostname);
    const entry = {
      id,
      name: r.name || id,
      nameEn: r.name || id,
      type: r.type || 'brand',
      instagram: r.instagram || null,
      shopUrl,
      platform: r.platform || 'unknown',
      discovery: r.discovery || { method: 'tbd' },
      status: r.status,
      notes:
        r.status === 'ready'
          ? `자동 판별됨 (${r.discovery?.method}).`
          : r.reason || '판별 실패',
    };
    const idx = registry.sources.findIndex(
      (s) => s.shopUrl.replace(/\/$/, '') === shopUrl.replace(/\/$/, '')
    );
    if (idx >= 0) {
      registry.sources[idx] = { ...registry.sources[idx], ...entry };
      updated++;
    } else {
      registry.sources.push(entry);
      added++;
    }
  }

  registry.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  return { added, updated, total: results.length, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('사용법: node src/bulk-add.js <입력.json>');
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(inputPath, 'utf8'));
  const summary = await bulkAdd(entries);
  console.log(`added=${summary.added} updated=${summary.updated} total=${summary.total}`);
  const byStatus = {};
  for (const r of summary.results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log('status breakdown:', byStatus);
  for (const r of summary.results) {
    console.log(`  [${r.status}] ${r.instagram || ''} -> ${r.shopUrl || '(no url)'} (${r.platform || ''})`);
  }
}
