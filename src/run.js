// 수집 실행기
//   node src/run.js                     -> brands.json에서 status:"ready"인 소스 전부
//   node src/run.js --source=999humanity -> 특정 소스만
//   node src/run.js --source=999humanity --limit=30  -> 처음 30개만 (빠른 테스트)
//
// 결과는 data/out/{source_id}.json 에 저장 (Supabase 연동은 다음 단계).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify } from './lib/taxonomy.js';
import { classifyGender } from './lib/gender.js';
import { collectShopify } from './adapters/shopify.js';
import { collectCafe24 } from './adapters/cafe24.js';
import { collectImweb } from './adapters/imweb.js';
import { collectSixshop } from './adapters/sixshop.js';
import { mapPool } from './lib/concurrency.js';
import { closeBrowser } from './lib/browser.js';

// 소스들은 전부 서로 다른 서버라 동시에 여러 개 처리해도 서로 부딪히지 않음.
// (서버 하나에 대한 예의상 동시성은 어댑터 안(CONCURRENCY)에서 이미 제한하고 있음)
const SOURCE_CONCURRENCY = 16;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'brands.json'), 'utf8'));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
let targets;
if (args.source) {
  const ids = String(args.source).split(',');
  targets = registry.sources.filter((s) => ids.includes(s.id));
} else {
  targets = registry.sources.filter((s) => s.status === 'ready');
}

// --skip-existing: 이미 수집해둔(data/out/{id}.json 있는) 소스는 건너뜀.
// 큰 배치를 동시성 올려서 재시작할 때, 이미 끝난 걸 또 처음부터 하지 않기 위함.
// kr-only.json: 해외 IP를 막는 쇼핑몰은 CI(GitHub Actions, 미국)에서 항상 0개라 건너뛴다(한국 PC에서 collect-kr로 수집).
if (process.env.GITHUB_ACTIONS) {
  const krOnly = new Set(JSON.parse(readFileSync(join(root, 'kr-only.json'), 'utf8')).ids);
  const skipped = targets.filter((s) => krOnly.has(s.id)).map((s) => s.id);
  if (skipped.length) { console.log('CI에서 건너뜀(해외 IP 차단, 한국 PC에서 수집):', skipped.join(', ')); targets = targets.filter((s) => !krOnly.has(s.id)); }
}

if (args['skip-existing']) {
  const before = targets.length;
  targets = targets.filter((s) => !existsSync(join(root, 'data', 'out', `${s.id}.json`)));
  console.log(`--skip-existing: ${before}개 중 ${targets.length}개만 처리 (나머지는 이미 존재)`);
}

if (targets.length === 0) {
  // CI에서 kr-only만 담긴 샤드는 할 일이 없는 게 정상 — 실패로 처리하지 않는다.
  if (process.env.GITHUB_ACTIONS && args.source) { console.log('수집할 대상 없음(전부 CI 제외 대상).'); process.exit(0); }
  console.error('대상 소스 없음. --source=<id> 확인 또는 brands.json의 status 확인.');
  process.exit(1);
}

const ADAPTERS = { shopify: collectShopify, cafe24: collectCafe24, imweb: collectImweb, sixshop: collectSixshop };

mkdirSync(join(root, 'data', 'out'), { recursive: true });

async function runOne(source) {
  const tag = `[${source.id}]`;
  const adapter = ADAPTERS[source.platform];
  if (!adapter) {
    console.log(`- skip ${source.id} (${source.platform} 어댑터 없음)`);
    return;
  }

  console.log(`\n${tag} 시작 · ${source.name} · ${source.platform}`);
  const t0 = Date.now();

  let items;
  try {
    items = await adapter(source, { limit });
  } catch (err) {
    console.error(`${tag} FAILED: ${err.stack || err.message}`);
    return;
  }

  const breakdown = {};
  let classified = 0;
  for (const it of items) {
    it.source_id = source.id;
    it.source_type = source.type;
    it.categories = classify(it.title, it.raw_category);
    it.gender = classifyGender(it.title, it.raw_category);
    it.fetched_at = new Date().toISOString();
    if (it.categories.length) classified++;
    for (const c of it.categories) breakdown[c] = (breakdown[c] || 0) + 1;
  }

  const outPath = join(root, 'data', 'out', `${source.id}.json`);
  writeFileSync(outPath, JSON.stringify(items, null, 2));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const noPrice = items.filter((i) => i.price == null).length;
  const noImg = items.filter((i) => !i.images.length).length;
  console.log(
    `${tag} 완료 · ${items.length}개 수집 · ${classified}개 분류 · ${secs}s` +
      (noPrice || noImg ? ` · 주의: 가격없음 ${noPrice} 이미지없음 ${noImg}` : '')
  );
}

await mapPool(targets, runOne, SOURCE_CONCURRENCY);
await closeBrowser(); // imweb 등에서 헤드리스 브라우저를 띄웠으면 정리
console.log('\n전체 완료.');
