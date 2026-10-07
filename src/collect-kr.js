// 해외 IP를 막는 쇼핑몰(kr-only.json)을 한국 IP(이 PC)에서 수집하고 Supabase에 올린다.
//   node src/collect-kr.js            -> kr-only.json의 전부
//   node src/collect-kr.js mono-prive -> 지정한 것만
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = JSON.parse(readFileSync(join(root, 'kr-only.json'), 'utf8')).ids;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;

const run = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' }).status;

console.log(`한국 IP 수집(한 곳씩 순서대로): ${ids.join(', ')}`);
// 여러 곳을 동시에 돌리면 내 PC/회선이 막혀서 페이지 로딩이 시간초과로 0개가 나오는 일이 있어(실측) 하나씩 처리한다.
let failed = 0;
// 사이트가 느리거나 일시적으로 응답이 비면 0개로 끝나는 일이 있어서(실측), 0개면 최대 3번까지 다시 시도한다.
const countOf = (id) => { try { return JSON.parse(readFileSync(join(root, 'data', 'out', `${id}.json`), 'utf8')).length; } catch { return 0; } };
for (const id of ids) {
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    if (run(['src/run.js', `--source=${id}`]) !== 0) continue;
    if (countOf(id) === 0) { console.warn(`  ${id}: 0개 수집 → 재시도 (${attempt}/3)`); continue; }
    ok = run(['src/load-supabase.js', id]) === 0;
  }
  if (!ok) { console.error(`! ${id} 실패`); failed++; }
}
console.log(failed ? `완료 (실패 ${failed}곳)` : '완료');
process.exit(failed ? 1 : 0);
