// 브랜드 등록 CLI (나중에 웹 UI의 "브랜드 등록" 버튼이 될 로직):
//   node src/add-brand.js <URL> [표시이름] [인스타핸들]
// URL 자동 판별 -> brands.json에 등록. 이미 있는 shopUrl이면 갱신만.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { detectPlatform } from './detect.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'brands.json');

export async function addBrand(url, { name, instagram, type = 'brand' } = {}) {
  const result = await detectPlatform(url);
  if (result.status === 'error') return result;

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const id = slugify(new URL(result.shopUrl).hostname);
  const displayName = name || id;

  const entry = {
    id,
    name: displayName,
    nameEn: displayName,
    type,
    instagram: instagram || null,
    shopUrl: result.shopUrl,
    platform: result.platform,
    discovery: result.discovery || { method: 'tbd' },
    status: result.status, // 'ready' | 'needs_review'
    notes:
      result.status === 'ready'
        ? `자동 판별됨 (${result.discovery.method}).`
        : result.reason,
  };

  const existingIdx = registry.sources.findIndex(
    (s) => s.shopUrl.replace(/\/$/, '') === result.shopUrl.replace(/\/$/, '')
  );
  if (existingIdx >= 0) {
    registry.sources[existingIdx] = { ...registry.sources[existingIdx], ...entry };
  } else {
    registry.sources.push(entry);
  }
  registry.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  return { ...entry, action: existingIdx >= 0 ? 'updated' : 'added' };
}

function slugify(hostname) {
  return hostname
    .replace(/^www\./, '')
    .replace(/\.(com|co\.kr|kr|link|net|store|shop)$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, name, instagram] = process.argv.slice(2);
  if (!url) {
    console.error('사용법: node src/add-brand.js <URL> [표시이름] [인스타핸들]');
    process.exit(1);
  }
  const result = await addBrand(url, { name, instagram });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'ready') {
    console.log(`\n등록 완료 (${result.action}). 수집: node src/run.js --source=${result.id}`);
  } else if (result.status === 'needs_review') {
    console.log('\n자동 판별 실패 — brands.json에 needs_review로 등록됨. 어댑터 검토 필요.');
  }
}
