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
  GROUPS = (data.groups || []).map((g) => ({ ...g, subs: g.subs && g.subs.length ? g.subs : g.children.map((c) => ({ id: c, label: (data.categories.find((x) => x.id === c) || {}).label || c, children: [c] })) }));
}
// 분류표는 거의 안 바뀌니 저장해둔 걸 바로 쓰고(첫 화면을 기다리게 하지 않음), 최신본은 뒤에서 받아 갱신한다.
async function loadTaxonomy() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('sf_tax2') || 'null'); } catch {}
  const fresh = fetch('./taxonomy.json').then((r) => r.json()).then((data) => { try { localStorage.setItem('sf_tax2', JSON.stringify(data)); } catch {} return data; });
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
    if (g) { g.children.forEach((c) => out.add(c)); continue; }
    const sub = GROUPS.flatMap((x) => x.subs).find((x) => x.id === id);
    if (sub) sub.children.forEach((c) => out.add(c));
    else if (CATEGORIES.some((c) => c.id === id)) out.add(id);
  }
  return [...out];
}

function labelOf(id) {
  const sub = GROUPS.flatMap((x) => x.subs).find((x) => x.id === id);
  if (sub) return sub.label;
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

// ── 한/영 호환 검색 ──
// 같은 뜻의 한국어/영어 표기를 한 묶음으로 둔다. 어느 쪽으로 검색해도 묶음 전체로 상품명을 찾는다.
// (한 글자 표기는 너무 넓게 걸려서 넣지 않음)
const BILINGUAL = [
  ['polo', '폴로', '폴로티', '폴로셔츠', '카라티', '피케', 'pique'],
  ['hoodie', '후드', '후디', '후드티'],
  ['sweatshirt', '맨투맨', '스웨트셔츠', '스웻셔츠', 'sweat'],
  ['knit', '니트', 'sweater', '스웨터'],
  ['cardigan', '가디건', '카디건'],
  ['denim', '데님', 'jean', 'jeans', '청바지'],
  ['cargo', '카고'],
  ['pants', 'trousers', 'trouser', '팬츠', '바지', '슬랙스', 'slacks'],
  ['shorts', '쇼츠', '반바지', '숏팬츠'],
  ['longsleeve', 'long sleeve', 'long-sleeve', '롱슬리브', '긴팔', '긴팔티'],
  ['tee', 't-shirt', 'tshirt', 't shirt', '티셔츠', '반팔', '반팔티'],
  ['shirt', 'shirts', '셔츠', 'blouse', '블라우스'],
  ['jacket', '자켓', '재킷'],
  ['coat', '코트'],
  ['padding', 'puffer', '패딩', '푸퍼'],
  ['vest', '베스트', '조끼', 'gilet'],
  ['skirt', '스커트', '치마'],
  ['dress', '원피스', '드레스', 'onepiece'],
  ['bag', '가방'],
  ['tote', '토트', '에코백'],
  ['backpack', '백팩'],
  ['cap', '볼캡', '캡', '야구모자'],
  ['beanie', '비니'],
  ['hat', '햇', '모자'],
  ['scarf', 'muffler', '스카프', '머플러', '목도리'],
  ['sneakers', 'sneaker', '스니커즈', '운동화'],
  ['boots', 'boot', '부츠'],
  ['loafer', 'loafers', '로퍼'],
  ['wallet', '지갑'],
  ['belt', '벨트'],
  ['socks', 'sock', '양말'],
  ['gloves', 'glove', '장갑'],
  ['sunglasses', 'eyewear', '선글라스', '안경'],
  ['leather', '레더', '가죽'],
  ['wool', '양모'],
  ['cotton', '코튼'],
  ['linen', '린넨', '리넨'],
  ['nylon', '나일론'],
  ['fleece', '플리스', '후리스', '뽀글이'],
  ['corduroy', '코듀로이', '골덴', '코르덴'],
  ['suede', '스웨이드'],
  ['cashmere', '캐시미어'],
  ['mohair', '모헤어'],
  ['velvet', '벨벳', '벨루어'],
  ['mesh', '메쉬', '매쉬'],
  ['stripe', 'striped', '스트라이프', '줄무늬'],
  ['check', 'plaid', '체크', '플래드'],
  ['logo', '로고'],
  ['vintage', '빈티지'],
  ['washed', '워시드', '워싱'],
  ['oversized', 'oversize', '오버사이즈', '오버핏'],
  ['zip-up', 'zipup', 'zip up', '집업', '지퍼'],
  ['hooded', '후디드'],
  ['bomber', '봄버', '블루종', 'blouson', 'ma-1'],
  ['trench', '트렌치'],
  ['jogger', 'joggers', '조거', '트레이닝'],
  ['sandals', 'sandal', '샌들', '슬리퍼'],
];
const normTok = (x) => String(x || '').toLowerCase().replace(/[\s\-_/]+/g, '');
const BI_INDEX = new Map(); // 정규화한 표기 -> 묶음 번호들
BILINGUAL.forEach((grp, i) => grp.forEach((w) => { const k = normTok(w); if (!BI_INDEX.has(k)) BI_INDEX.set(k, new Set()); BI_INDEX.get(k).add(i); }));
const okVariant = (v) => (/[가-힣]/.test(v) ? v.length >= 2 : v.length >= 3);
const SPECIAL = /[,()"\\]/;

// 한 검색어가 상품명에서 어떤 표기들로 나타날 수 있는지(한/영 호환). 검색어 자신은 항상 포함.
function variantsOf(token, cats) {
  const out = new Set([token]);
  const groups = BI_INDEX.get(normTok(token));
  if (groups) for (const gi of groups) for (const w of BILINGUAL[gi]) if (okVariant(w)) out.add(w);
  for (const cid of cats || []) {
    const c = CATEGORIES.find((x) => x.id === cid);
    if (!c) continue;
    for (const k of [...(c.keywords || []), c.label]) if (k && okVariant(k) && (k.length >= 4 || /[가-힣]/.test(k))) out.add(k);
  }
  return [...out].filter((v) => !SPECIAL.test(v)).slice(0, 16);
}

// 띄어쓰기 때문에 쪼개진 표현("long sleeve", "polo shirt")은 한 덩어리로 먼저 찾는다
function phraseMatch(tokens, i) {
  for (const n of [3, 2]) {
    if (i + n > tokens.length) continue;
    const phrase = tokens.slice(i, i + n).join(' ');
    if (resolveCategoryToken(phrase).length || BI_INDEX.has(normTok(phrase))) return { n, phrase };
  }
  return null;
}

// "블랙폴로"처럼 색상이 앞에 붙어 있는 한국어 한 단어를 색상 + 나머지로 나눈다
function splitColorPrefix(token) {
  const keys = Object.keys(COLOR_MAP).filter((k) => /[가-힣]/.test(k) && k.length >= 2).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (token.startsWith(k) && token.length > k.length) {
      const rest = token.slice(k.length);
      if (resolveCategoryToken(rest).length || BI_INDEX.has(normTok(rest))) return [k, rest];
    }
  }
  return null;
}

// 자연어 검색어 -> { categories, colors, keywords, terms }
//  - categories/colors/keywords: 예전과 같은 형태(칩 표시·안내 문구에 사용)
//  - terms: 검색어 하나하나의 { text, cats, variants } — 검색할 때 카테고리와 상품명(한/영 표기)을 함께 본다
function parseQuery(raw) {
  const cleaned = stripFillers((raw || '').trim());
  let tokens = cleaned.split(/\s+/).filter(Boolean);
  let categories = [];
  let colors = [];
  const keywords = [];
  const terms = [];
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i];
    const ph = phraseMatch(tokens, i);
    if (ph) { t = ph.phrase; i += ph.n - 1; }
    let c = resolveCategoryToken(t);
    let col = resolveColorToken(t);
    if (!c.length && !col) {
      const sp = splitColorPrefix(t);
      if (sp) { tokens.splice(i + 1, 0, sp[1]); t = sp[0]; col = resolveColorToken(t); c = []; }
    }
    if (c.length) { categories.push(...c); terms.push({ text: t, cats: c, variants: variantsOf(t, c) }); }
    else if (col) colors.push(col);
    else {
      // 카테고리로 직접 안 잡히는 표기(jeans, trousers 등)도 같은 뜻 묶음에 카테고리로 잡히는 표기가 있으면(청바지→데님 팬츠) 그 카테고리를 함께 쓴다
      const own = new Set();
      for (const gi of BI_INDEX.get(normTok(t)) || []) for (const w of BILINGUAL[gi]) { const r = resolveCategoryToken(w); if (r.length && r.length <= 2) r.forEach((id) => own.add(id)); }
      if (own.size) { categories.push(...own); terms.push({ text: t, cats: [...own], variants: variantsOf(t, [...own]) }); }
      else { keywords.push(t); terms.push({ text: t, cats: [], variants: variantsOf(t, []) }); }
    }
  }
  categories = [...new Set(categories)];
  colors = [...new Set(colors)];
  return { categories, colors, keywords, terms };
}

window.StyleFinderTaxonomy = { loadTaxonomy, parseQuery, expandSelection, labelOf, stripCategoryTokens, get CATEGORIES() { return CATEGORIES; }, get GROUPS() { return GROUPS; }, COLOR_LABELS };
