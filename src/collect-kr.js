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

console.log(`한국 IP 수집: ${ids.join(', ')}`);
if (run(['src/run.js', `--source=${ids.join(',')}`]) !== 0) process.exit(1);
// 안전장치: 수집이 하나도 안 됐으면(차단/네트워크) 올리지 않음 — load-supabase에도 불완전 수집 삭제 방지가 있지만 한 번 더.
if (run(['src/load-supabase.js', ...ids]) !== 0) process.exit(1);
console.log('완료');
