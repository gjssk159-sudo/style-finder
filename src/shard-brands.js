// brands.json의 ready 소스를 SHARD_SIZE개씩 묶어서 GitHub Actions matrix용 JSON 배열로 출력.
// 브랜드가 늘어나면 SHARD_SIZE를 올려서 샤드 개수를 조절 (matrix는 한 워크플로우당 256개 job까지 가능).
//   node src/shard-brands.js            -> ["id1,id2,...", "id11,id12,...", ...]
//   SHARD_SIZE=20 node src/shard-brands.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'brands.json'), 'utf8'));
const ready = registry.sources.filter((s) => s.status === 'ready').map((s) => s.id);

const size = Number(process.env.SHARD_SIZE || 12);
const shards = [];
for (let i = 0; i < ready.length; i += size) shards.push(ready.slice(i, i + size).join(','));

console.log(JSON.stringify(shards));
