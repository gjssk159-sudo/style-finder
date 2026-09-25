// taxonomy.json 기반 카테고리 분류.
// 상품명 + 원본카테고리 + 설명 텍스트에서 키워드를 찾아 category id를 부여.
//
// 매칭 규칙:
//  - 한글 키워드: 부분 문자열 (한글은 띄어쓰기가 불규칙)
//  - 영문 키워드(4자 이상): 뒤쪽 경계 + 복수형 s/es 허용, 앞쪽은 느슨하게
//      → "overcoat"/"carcoat"가 "coat"로, "workpants"가 "pant"로 잡힘
//  - 영문 키워드(3자 이하: hat, cap, tee, bag ...): 앞뒤 경계 모두 요구
//      → "what"이 "hat"으로 잡히는 사고 방지
//  - 키워드 앞에 "^"를 붙이면 4자 이상이어도 앞쪽 경계까지 강제(엄격 매칭)
//      → "ring"을 그냥 쓰면 "spring"에도 걸리므로 "^ring"으로; "tanker jacket"의 "tank"도 마찬가지
//  - 키워드 안의 공백/하이픈은 공백·하이픈·붙여쓰기 어느 쪽으로 써도 매칭(zip up = zip-up = zipup)
// exclude 키워드에 걸리면 그 카테고리는 스킵. 상품 하나가 여러 카테고리에 속할 수 있음.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const taxonomy = JSON.parse(readFileSync(join(root, 'taxonomy.json'), 'utf8'));

export const CATEGORIES = taxonomy.categories;

const isAscii = (s) => /^[\x00-\x7f]+$/.test(s);
const reCache = new Map();

function keywordRegex(k) {
  let re = reCache.get(k);
  if (!re) {
    const strict = k.startsWith('^');
    const raw = strict ? k.slice(1) : k;
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 여러 단어로 된 키워드는 실제 상품명에서 "zip up"/"zip-up"/"zipup"처럼 공백·하이픈·붙여쓰기가
    // 제각각이라, 키워드 안의 구분자를 세 가지 다 허용하는 패턴으로 바꿔서 하나만 등록해도 다 잡히게.
    const flexible = esc.replace(/[ \-]+/g, '[\\s-]*');
    const body = `${flexible}(?:es|s)?(?=[^a-z0-9]|$)`;
    const pattern = raw.length <= 3 || strict ? `(?<![a-z0-9])${body}` : body;
    re = new RegExp(pattern, 'i');
    reCache.set(k, re);
  }
  return re;
}

function hit(hay, keyword) {
  const k = keyword.toLowerCase();
  return isAscii(k) ? keywordRegex(k).test(hay) : hay.includes(k);
}

export function classify(...texts) {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  if (!hay.trim()) return [];
  const hits = [];
  for (const cat of taxonomy.categories) {
    if ((cat.exclude || []).some((x) => hit(hay, x))) continue;
    if (cat.keywords.some((k) => hit(hay, k))) hits.push(cat.id);
  }
  return hits;
}
