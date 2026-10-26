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

// ───────────────────────── 쇼핑몰 자체 카테고리 우선 분류 ─────────────────────────
// 상품명만 보면 "ZIP-UP HOODIE", "CARDIGAN", "VEST"를 아우터로 보지만 쇼핑몰은 TOPS에 넣어둔 경우가 많다.
// 쇼핑몰이 TOPS/OUTER/BOTTOM/ACC/HATS 같이 "종류"를 분명히 말해주면 그 구분(그룹)을 따르고,
// 세부 종류는 상품명으로 고른다. 시즌/세일/에피소드/소재(denim)/태그처럼 종류가 아닌 카테고리는 무시.
// 단, 신발·가방·모자·소품은 상품명이 객관적이라(스카프가 TOPS에 들어있는 등 쇼핑몰 실수) 상품명이 이기게 둔다.
const SITE_TYPE_PATTERNS = [
  ['shoes', /(^|[^a-z])(shoes?|sneakers?|boots?|sandals?|footwear)([^a-z]|$)|신발|슈즈|스니커즈|부츠|샌들/i],
  ['bag', /(^|[^a-z])(bags?|backpacks?|totes?)([^a-z]|$)|가방|백팩|토트/i],
  ['cap', /(^|[^a-z])(hats?|caps?|beanies?|headwear)([^a-z]|$)|모자|비니/i],
  ['acc', /(^|[^a-z])(acc|accessor(y|ies)|jewel(ry|lery)|socks?|belts?|wallets?|eyewear)([^a-z]|$)|악세서리|액세서리|양말|벨트|지갑|주얼리/i],
  ['dress_skirt', /(^|[^a-z])(skirts?|dress(es)?|one-?pieces?)([^a-z]|$)|원피스|스커트|치마/i],
  ['outer', /(^|[^a-z])(outers?|outerwears?|jackets?|coats?|jumpers?|paddings?|blousons?)([^a-z]|$)|아우터|자켓|재킷|코트|패딩|점퍼/i],
  ['bottom', /(^|[^a-z])(bottoms?|pants|trousers|slacks|jeans|shorts)([^a-z]|$)|하의|바지|팬츠|슬랙스|청바지/i],
  ['top', /(^|[^a-z])(tops?|tees?|t-?shirts?|shirts?|sweats?|sweatshirts?|hood(ie|y|ies)?|knits?|sweaters?)([^a-z]|$)|상의|탑$|티셔츠|셔츠|니트|맨투맨|후드/i],
];
const SOFT_GROUPS = new Set(['top', 'outer', 'bottom', 'dress_skirt']);
const groupOfLeaf = (id) => (GROUPS.find((g) => g.children.includes(id)) || {}).id || null;

// 같은 뜻의 다른 그룹 카테고리로 옮길 때(쇼핑몰이 TOPS에 넣은 지퍼 후드/카디건/조끼 등)
const EQUIV = {
  top: { hoodie_zipup: 'hoodie', cardigan: 'knit', vest: 'sleeveless_top', padding_vest: 'sleeveless_top', fleece: 'sweatshirt', track_jacket: 'sweatshirt', jacket: 'shirt', blouson: 'shirt', blazer: 'shirt', coat: 'shirt', trench: 'shirt' },
  outer: { hoodie: 'hoodie_zipup', sweatshirt: 'fleece', knit: 'cardigan', shirt: 'jacket', sleeveless_top: 'vest' },
};
const DEFAULT_LEAF = { top: 'tshirt', outer: 'jacket', bottom: 'pants', dress_skirt: 'onepiece', shoes: 'shoes', bag: 'bag', cap: 'hat', acc: 'acc' };

// 쇼핑몰 카테고리 경로("홈 > Shop > Tees > S/S Tee")의 뒤쪽(가장 구체적인)부터 종류를 말하는 마디를 찾는다.
function siteGroup(raw) {
  if (!raw) return null;
  const segs = String(raw).split(/\s*[>|]\s*/).map((s) => s.trim()).filter(Boolean).reverse();
  for (const seg of segs) {
    if (seg.length > 40) continue; // 태그 나열(콤마가 많은 긴 문자열)은 카테고리가 아님
    const parts = seg.split(/\s*,\s*/);
    for (const part of parts) {
      for (const [group, re] of SITE_TYPE_PATTERNS) if (re.test(part)) return group;
    }
  }
  return null;
}

export function classifyItem(title, raw) {
  const site = siteGroup(raw);
  if (!site) return classify(title, raw); // 쇼핑몰 카테고리가 종류를 말해주지 않으면 기존 방식
  const byTitle = classify(title, '')[0];
  const tGroup = byTitle ? groupOfLeaf(byTitle) : null;
  if (byTitle && byTitle !== 'etc' && tGroup === site) return [byTitle];
  // 상품명이 명백한 소품·가방·신발·모자면(쇼핑몰이 의류 쪽에 넣어둔 경우, 또는 소품 안에서 칸이 다른 경우) 상품명을 따른다
  if (tGroup && !SOFT_GROUPS.has(tGroup) && tGroup !== 'etc') return [byTitle];
  const g = GROUPS.find((x) => x.id === site);
  if (!g) return classify(title, raw);
  // 쇼핑몰이 정한 그룹 안에서 가장 알맞은 세부를 고른다
  const mapped = (EQUIV[site] || {})[byTitle];
  if (mapped && g.children.includes(mapped)) return [mapped];
  const fromRaw = classifyText(String(raw).split(/\s*>\s*/).pop());
  if (fromRaw && g.children.includes(fromRaw)) return [fromRaw];
  return [DEFAULT_LEAF[site] && g.children.includes(DEFAULT_LEAF[site]) ? DEFAULT_LEAF[site] : g.children[0]];
}
