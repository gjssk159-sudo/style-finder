// 브랜드명 표준화: 같은 브랜드가 소스마다 다르게 적힘 -> "SAN SAN GEAR"/"SANSAN GEAR"/"산산기어"가
// 전부 같은 브랜드로 묶이도록 brands.json(name/nameEn)을 별칭 사전으로 사용.
// 자사몰(type:brand)에서는 source.name(한글) 그대로 쓰지만, 편집샵이 추출한 영문 브랜드명은
// 다른 표기일 수 있어서 이 사전을 거쳐야 같은 그룹으로 묶임.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 영문 표기 차이(공백/특수문자) 흡수. 한글은 그대로(한/영은 별도 별칭으로만 연결).
function normKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

let aliasMap = null;
let displayMap = null;
let idMap = null; // canon key -> brands.json의 id (Supabase FK용, 등록 안 된 브랜드는 없음)

function load() {
  if (aliasMap) return;
  aliasMap = new Map();
  displayMap = new Map();
  idMap = new Map();
  let registry;
  try {
    registry = JSON.parse(readFileSync(join(root, 'brands.json'), 'utf8'));
  } catch {
    registry = { sources: [] };
  }
  for (const s of registry.sources) {
    if (s.type !== 'brand') continue; // 편집샵 자신의 이름은 상품 브랜드가 아니므로 제외
    const canon = normKey(s.name);
    if (!canon) continue;
    for (const alias of [s.name, s.nameEn, s.id]) {
      const k = normKey(alias);
      if (k) aliasMap.set(k, canon);
    }
    if (!displayMap.has(canon)) displayMap.set(canon, s.name);
    if (!idMap.has(canon)) idMap.set(canon, s.id);
  }
}

// 원본 브랜드 문자열 -> { key: 그룹핑용 표준 키, display: 화면 표시용 이름, id: brands.json 등록 id(없으면 null) }
export function resolveBrand(raw) {
  load();
  const norm = normKey(raw);
  const canon = aliasMap.get(norm) || norm;
  const display = displayMap.get(canon) || String(raw || '').trim();
  const id = idMap.get(canon) || null;
  return { key: canon, display, id };
}

// brands.json이 바뀐 뒤(신규 브랜드 등록 등) 캐시 갱신용
export function reloadBrandAliases() {
  aliasMap = null;
  displayMap = null;
  load();
}
