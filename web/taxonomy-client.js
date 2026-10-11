// src/lib/taxonomy.js + src/server.js의 검색어 해석 로직을 브라우저용으로 옮긴 것.
// (Node 백엔드 없이 정적 사이트에서 바로 쓰기 위함 — taxonomy.json 바뀌면 이 파일도 같이 봐야 함)

const COLOR_MAP = {
  블랙: 'black', black: 'black',
  화이트: 'white', white: 'white',
  아이보리: 'ivory', ivory: 'ivory',
  크림: 'cream', cream: 'cream',
  베이지: 'beige', beige: 'beige', ecru: 'beige',
  카키: 'khaki', khaki: 'khaki',
  네이비: 'navy', navy: 'navy',
  블루: 'blue', blue: 'blue',
  스카이: 'sky', sky: 'sky',
  그린: 'green', green: 'green',
  올리브: 'olive', olive: 'olive',
  그레이: 'grey', 그레이지: 'grey', grey: 'grey', gray: 'grey', greige: 'grey',
  차콜: 'charcoal', charcoal: 'charcoal',
  브라운: 'brown', brown: 'brown', 초콜릿: 'brown', chocolate: 'brown',
  탄: 'tan', tan: 'tan', 카멜: 'camel', camel: 'camel',
  퍼플: 'purple', purple: 'purple', 라벤더: 'lavender', lavender: 'lavender',
  핑크: 'pink', pink: 'pink',
  레드: 'red', red: 'red', 와인: 'wine', wine: 'wine', 버건디: 'burgundy', burgundy: 'burgundy',
  오렌지: 'orange', orange: 'orange',
  옐로우: 'yellow', 옐로: 'yellow', yellow: 'yellow',
  샌드: 'sand', sand: 'sand',
  민트: 'mint', mint: 'mint',
  멜란지: 'melange', melange: 'melange',
  데님: 'denim', denim: 'denim', 인디고: 'indigo', indigo: 'indigo', 워시드: 'washed', washed: 'washed',
  silver: 'silver', gold: 'gold', multi: 'multi',
};
const COLOR_LABELS = {
  black: '블랙', white: '화이트', ivory: '아이보리', cream: '크림', beige: '베이지', khaki: '카키',
  navy: '네이비', blue: '블루', sky: '스카이', green: '그린', olive: '올리브', grey: '그레이',
  charcoal: '차콜', brown: '브라운', tan: '탄', camel: '카멜', purple: '퍼플', lavender: '라벤더',
  pink: '핑크', red: '레드', wine: '와인', burgundy: '버건디', orange: '오렌지', yellow: '옐로우',
  sand: '샌드', mint: '민트', melange: '멜란지', denim: '데님', indigo: '인디고', washed: '워시드',
  silver: '실버', gold: '골드', multi: '멀티',
};
const QUERY_COLOR_ALIASES = {
  노란: 'yellow', 노랑: 'yellow', 노란색: 'yellow',
  까만: 'black', 까망: 'black', 까만색: 'black', 검은: 'black', 검은색: 'black', 검정: 'black', 검정색: 'black',
  하얀: 'white', 하양: 'white', 하얀색: 'white', 흰: 'white', 흰색: 'white',
  파란: 'blue', 파랑: 'blue', 파란색: 'blue',
  빨간: 'red', 빨강: 'red', 빨간색: 'red',
  초록: 'green', 초록색: 'green', 녹색: 'green',
  보라: 'purple', 보라색: 'purple',
  분홍: 'pink', 분홍색: 'pink',
  갈색: 'brown',
  남색: 'navy',
  회색: 'grey', 쥐색: 'grey',
  주황: 'orange', 주황색: 'orange',
};

const FILLER_PHRASES = [
  '찾아줘', '찾아주라', '찾아줄래', '찾아봐줘', '찾아봐', '찾아주세요', '찾아주실래요',
  '보여줘', '보여줘봐', '보여주세요', '보여줄래',
  '추천해줘', '추천해주세요', '추천좀', '추천',
  '골라줘', '골라주세요', '알려줘', '알려주세요',
  '있어', '있나요', '있을까', '있을까요', '있음',
  '해줘', '해주세요', '해줄래', '부탁해', '부탁', '줘', '좀',
];

let CATEGORIES = [];
let GROUPS = [];
function applyTaxonomy(data) {
  CATEGORIES = data.categories;
  GROUPS = data.groups || [];
}
// 분류표는 거의 안 바뀌니 저장해둔 걸 바로 쓰고(첫 화면을 기다리게 하지 않음), 최신본은 뒤에서 받아 갱신한다.
async function loadTaxonomy() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('sf_tax') || 'null'); } catch {}
  const fresh = fetch('./taxonomy.json').then((r) => r.json()).then((data) => { try { localStorage.setItem('sf_tax', JSON.stringify(data)); } catch {} return data; });
  if (cached && Array.isArray(cached.categories) && cached.categories.length) {
    applyTaxonomy(cached);
    fresh.then(applyTaxonomy).catch(() => {});
    return;
  }
  applyTaxonomy(await fresh);
}

// 상위(그룹 id) 또는 하위(카테고리 id) 선택 → 검색에 쓸 카테고리 id 목록
function expandSelection(sel) {
  // 여러 개 선택 가능: 배열(또는 단일 id)을 받아 합집합으로 펼친다
  const list = Array.isArray(sel) ? sel : sel ? [sel] : [];
  const out = new Set();
  for (const id of list) {
    const g = GROUPS.find((x) => x.id === id);
    if (g) g.children.forEach((c) => out.add(c));
    else if (CATEGORIES.some((c) => c.id === id)) out.add(id);
  }
  return [...out];
}

function labelOf(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.label : id;
}

// 검색어에서 카테고리 단어만 빼고 나머지(브랜드/색상/상품명)는 그대로 — 칩으로 카테고리를 고를 때 사용
function stripCategoryTokens(raw) {
  return (raw || '').split(/\s+/).filter((tok) => tok && !resolveCategoryToken(tok).length).join(' ');
}

function stripFillers(raw) {
  let s = raw.trim().replace(/[?？!！.]+$/g, '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FILLER_PHRASES) {
      const re = new RegExp('(^|\\s)' + f + '$');
      if (re.test(s)) {
        s = s.replace(re, '$1').trim();
        changed = true;
      }
    }
  }
  return s;
}

function resolveCategoryToken(token) {
  const s = token.trim().toLowerCase();
  if (!s) return [];
  const exact = CATEGORIES.filter(
    (c) => c.id === s || c.label.toLowerCase() === s || (c.queryAliases || []).some((a) => a.toLowerCase() === s)
  ).map((c) => c.id);
  if (exact.length) return exact;
  return CATEGORIES.filter((c) => c.keywords.some((k) => k.toLowerCase() === s)).map((c) => c.id);
}

function resolveColorToken(token) {
  const s = token.trim().toLowerCase();
  if (!s) return null;
  return COLOR_MAP[s] || QUERY_COLOR_ALIASES[s] || null;
}

// 자연어 검색어 -> { categories, colors, keywords(나머지는 브랜드/상품명 텍스트 매칭용) }
function parseQuery(raw) {
  const cleaned = stripFillers((raw || '').trim());
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let categories = [];
  let colors = [];
  const keywords = [];
  for (const t of tokens) {
    const c = resolveCategoryToken(t);
    const col = resolveColorToken(t);
    if (c.length) categories.push(...c);
    else if (col) colors.push(col);
    else keywords.push(t);
  }
  categories = [...new Set(categories)];
  colors = [...new Set(colors)];
  return { categories, colors, keywords };
}

window.StyleFinderTaxonomy = { loadTaxonomy, parseQuery, expandSelection, labelOf, stripCategoryTokens, get CATEGORIES() { return CATEGORIES; }, get GROUPS() { return GROUPS; }, COLOR_LABELS };
