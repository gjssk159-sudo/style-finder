// 전체 검사: src/·web/의 JS 파일과 JSON 설정이 문법상 깨지지 않았는지 확인한다.
// 테스트가 없는 프로젝트라 "최소한 열리기는 하는지"를 기계로 보장하는 용도. 실행: npm run check
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const skip = new Set(['node_modules', 'vendor', '.git']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = [...walk(join(root, 'src')), ...walk(join(root, 'web')), join(root, 'web-server.js')];
const jsonFiles = ['brands.json', 'taxonomy.json', 'kr-only.json', 'package.json', 'vercel.json'].map((f) => join(root, f));
let failed = 0;

for (const f of files.filter((f) => extname(f) === '.js')) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`❌ ${f}\n${r.stderr}`); }
}
for (const f of [...jsonFiles, ...files.filter((f) => extname(f) === '.json')]) {
  try { JSON.parse(readFileSync(f, 'utf8')); } catch (e) { failed++; console.error(`❌ ${f}: ${e.message}`); }
}

// 화면은 web/taxonomy.json 사본을 읽는다 — 원본(taxonomy.json)과 어긋나면 검색 결과가 수집 분류와 달라진다.
const tax = (p) => JSON.stringify(JSON.parse(readFileSync(join(root, p), 'utf8')));
try {
  if (tax('taxonomy.json') !== tax('web/taxonomy.json')) { failed++; console.error('❌ taxonomy.json 과 web/taxonomy.json 내용이 다름 — 원본을 web/ 에 복사할 것'); }
} catch { /* 파싱 오류는 위에서 이미 셈 */ }

console.log(failed ? `실패 ${failed}개` : '전체 검사 통과');
process.exitCode = failed ? 1 : 0;
