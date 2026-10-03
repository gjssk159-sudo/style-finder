// taxonomy.json 기반 카테고리 분류 — "마지막 명사가 본체" 방식.
//
// 예전엔 상품명에 카테고리 키워드가 하나라도 있으면 전부 붙였는데, 그러면
// "DENIM SKIRT"(스커트+데님), "KNIT VEST"(베스트+니트), "TRUCKER CAP"(캡+재킷)처럼 수식어로
// 쓰인 단어까지 카테고리가 돼서 오분류가 만연했다. 영어도 한글도 상품명은 끝 단어가 실제
// 종류이므로, 이제 상품 하나에 대표 카테고리 하나(=본체)만 부여한다.
//
// 분류 순서:
//  1) 상품명에서 대괄호/소괄호 안(날짜·색상·"[예약배송]" 등)을 지우고, "w/", "with", "&", "+" 뒤(딸려오는
//     부속품: "Dress w/ Belt Bag")는 잘라낸다.
//  2) 각 카테고리의 키워드가 걸린 위치를 찾아, 문장 끝에 가장 가까운 것(끝 위치가 가장 뒤)을 본체로.
//     끝 위치가 같으면 더 긴 키워드(sweatshirt > tshirt)가 이긴다.
//  3) 본체의 "종류"(바지/재킷/코트/패딩/원피스/스커트/신발/가방/모자/소품...)가 정해지면, 같은 종류의 세부
//     카테고리(taxonomy의 parent)가 상품명 어디에 있든 세부로 분류한다(COTTON BOOTCUT PANTS → 코튼 팬츠,
//     LEATHER BIKER JACKET → 레더 재킷, CARGO MESSENGER BAG → 크로스백).
//  4) 상품명에서 하나도 못 찾았을 때만 원본카테고리 텍스트로 같은 과정을 한 번 더, 그래도 없으면 "기타".
//
// 키워드 매칭 규칙:
//  - 한글 키워드: 부분 문자열 (한글은 띄어쓰기가 불규칙)
//  - 영문 키워드(4자 이상): 뒤쪽 경계 + 복수형 s/es 허용, 앞쪽은 느슨하게 ("workpants"→"pant")
//  - 영문 키워드(3자 이하): 앞뒤 경계 모두 요구 ("what"이 "hat"으로 잡히는 사고 방지)
//  - 키워드 앞에 "^"를 붙이면 앞쪽 경계까지 강제
//  - 키워드 안의 공백/하이픈은 공백·하이픈·붙여쓰기 어느 쪽으로 써도 매칭
//  - cat.weakKeywords: 다른 키워드가 하나도 없을 때만 본체 후보가 되는 약한 키워드(예: "pullover", 맨 끝 "T")
//  - cat.modifierKeywords: 본체가 될 순 없고 세부 분류를 고르는 데만 쓰는 수식어(예: leather → 레더 재킷)
// exclude 키워드에 걸리면 그 카테고리는 스킵.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const taxonomy = JSON.parse(readFileSync(join(root, 'taxonomy.json'), 'utf8'));

export const CATEGORIES = taxonomy.categories;
export const GROUPS = taxonomy.groups || [];

const isAscii = (s) => /^[\x00-\x7f]+$/.test(s);
const reCache = new Map();

function keywordRegex(k) {
  let re = reCache.get(k);
  if (!re) {
    const strict = k.startsWith('^');
    const raw = strict ? k.slice(1) : k;
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = esc.replace(/[ \-]+/g, '[\\s-]*');
    const body = `${flexible}(?:es|s)?(?=[^a-z0-9]|$)`;
    const pattern = raw.length <= 3 || strict ? `(?<![a-z0-9])${body}` : body;
    re = new RegExp(pattern, 'ig');
    reCache.set(k, re);
  }
  return re;
}

// 키워드가 hay에서 걸린 마지막 위치 { end, len } (없으면 null)
function lastMatch(hay, keyword) {
  const k = keyword.toLowerCase();
  if (!isAscii(k)) {
    const i = hay.lastIndexOf(k);
    return i < 0 ? null : { end: i + k.length, len: k.length };
  }
  const re = keywordRegex(k);
  re.lastIndex = 0;
  let last = null;
  let m;
  while ((m = re.exec(hay))) {
    last = { end: m.index + m[0].length, len: m[0].length };
    if (m[0].length === 0) re.lastIndex++;
  }
  return last;
}

function hitExcluded(hay, x) {
  return lastMatch(hay, x) !== null;
}

// 괄호 안(색상·날짜·예약배송 문구)을 지우고, 부속품이 딸려오는 뒷부분은 잘라낸다.
function cleanTitle(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ');
  const cut = t.search(/\s(?:w\/|with)\s|\s&\s|\s\+\s|\s\/\s/);
  if (cut > 0) t = t.slice(0, cut);
  return t.replace(/\s+/g, ' ').trim();
}

function bestMatch(hay, keywords) {
  let best = null;
  for (const k of keywords || []) {
    const m = lastMatch(hay, k);
    if (m && (!best || m.end > best.end || (m.end === best.end && m.len > best.len))) best = m;
  }
  return best;
}

// strong: 확실한 키워드 / weak: 다른 단서가 하나도 없을 때만 본체 후보 / mods: 본체가 될 순 없고
// 같은 종류의 세부 분류를 고르는 데만 쓰는 수식어(예: leather)
function findHits(hay) {
  const strong = [];
  const weak = [];
  const mods = [];
  for (const cat of taxonomy.categories) {
    if (cat.id === 'etc') continue;
    if ((cat.exclude || []).some((x) => hitExcluded(hay, x))) continue;
    const sm = bestMatch(hay, cat.keywords);
    if (sm) strong.push({ id: cat.id, ...sm });
    const wm = bestMatch(hay, cat.weakKeywords);
    if (wm) weak.push({ id: cat.id, ...wm });
    const mm = bestMatch(hay, cat.modifierKeywords);
    if (mm) mods.push({ id: cat.id, ...mm });
  }
  return { strong, weak, mods };
}

const MODIFIER_IDS = new Set((taxonomy.categories || []).filter((c) => c.modifier).map((c) => c.id));
const ORDER = new Map(taxonomy.categories.map((c, i) => [c.id, i]));
const PARENT = new Map(taxonomy.categories.filter((c) => c.parent).map((c) => [c.id, c.parent]));
const typeOf = (id) => PARENT.get(id) || id;

function pickHead(hits) {
  return hits.reduce((a, b) => (b.end > a.end || (b.end === a.end && b.len > a.len) ? b : a));
}

// 본체의 "종류"가 정해지면, 그 종류 안의 세부 카테고리(parent 지정된 것: 데님/카고/트러커/롱패딩/숏팬츠...)가
// 상품명 어디에든 있으면 세부로, 없으면 그 종류의 기본 카테고리로. 세부가 여러 개면 taxonomy 배열 순서가 우선순위.
function refine(headType, hits) {
  const subs = hits
    .map((h) => h.id)
    .filter((id) => PARENT.get(id) === headType)
    .sort((a, b) => ORDER.get(a) - ORDER.get(b));
  return subs.length ? subs[0] : headType;
}

function classifyText(text) {
  const hay = cleanTitle(text);
  if (!hay) return null;
  const { strong, weak, mods } = findHits(hay);
  const real = (hs) => hs.filter((h) => !MODIFIER_IDS.has(h.id));
  const heads = real(strong).length ? real(strong) : real(weak);
  if (!heads.length) return null; // 코튼/나일론/카고/leather 같은 수식어만 있으면 판단 보류
  return refine(typeOf(pickHead(heads).id), [...strong, ...weak, ...mods]);
}

// classify(title, raw_category, ...): 첫 인자(상품명)에서 먼저 찾고, 없으면 나머지(원본 카테고리 등)에서 찾는다.
export function classify(title, ...rest) {
  const fromTitle = classifyText(title);
  const restText = rest.filter(Boolean).join(' ');
  const fromRest = restText ? classifyText(restText) : null;
  // 상품명엔 그냥 "Tee"라고만 있고 원본 카테고리에 롱슬리브라고 돼 있는 경우(예: HATCHINGROOM)
  if (fromTitle === 'tshirt' && fromRest === 'longsleeve_tee') return ['longsleeve_tee'];
  if (fromTitle) return [fromTitle];
  return [fromRest || 'etc'];
}
