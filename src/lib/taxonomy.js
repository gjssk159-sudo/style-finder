// taxonomy.json 기반 카테고리 분류.
// 상품명 + 원본카테고리 + 설명 텍스트에서 키워드를 찾아 category id를 부여.
//
// 매칭 규칙:
//  - 한글 키워드: 부분 문자열 (한글은 띄어쓰기가 불규칙)
//  - 영문 키워드(4자 이상): 뒤쪽 경계 + 복수형 s/es 허용, 앞쪽은 느슨하게
//      → "overcoat"가 "coat"로 잡히되 "bootscut"은 "boots"로 안 잡힘
//  - 영문 키워드(3자 이하: hat, cap, tee, bag ...): 앞뒤 경계 모두 요구
//      → "what"이 "hat"으로 잡히는 사고 방지
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
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = `${esc}(?:es|s)?(?=[^a-z0-9]|$)`;
    const pattern = k.length <= 3 ? `(?<![a-z0-9])${body}` : body;
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
