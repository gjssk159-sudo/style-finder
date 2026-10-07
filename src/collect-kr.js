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
for (const id of ids) {
  if (run(['src/run.js', `--source=${id}`]) !== 0 || run(['src/load-supabase.js', id]) !== 0) { console.error(`! ${id} 실패`); failed++; }
}
console.log(failed ? `완료 (실패 ${failed}곳)` : '완료');
process.exit(failed ? 1 : 0);
