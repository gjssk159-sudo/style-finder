// 로컬 검색 서버:  node src/server.js  ->  http://localhost:5173
//   GET  /api/categories                    카테고리 목록
//   GET  /api/brands                        등록된 브랜드 목록 (필터용)
//   GET  /api/facets                        실제 데이터에 존재하는 색상/사이즈 목록
//   GET  /api/search?q=&color=&size=&brand=&priceMin=&priceMax=&inStock=1   검색
//   POST /api/add-brand  {url, name?, instagram?}   브랜드 실시간 등록(자동 판별)
//   GET  /                                  검색 화면(단일 HTML)
//
// 검색어는 "노란색 후드집업 찾아줘" 같은 자연스러운 문장도 받는다:
//  1) 끝의 "찾아줘/보여줘/있어?/추천해줘" 같은 상투어를 벗겨내고
//  2) 남은 단어를 하나씩 봐서: 카테고리/색상으로 정확히 읽히면 그 필터로,
//     아니면 브랜드/상품명 텍스트 필터(AND)로 취급한다.
//  ("셔츠"는 라벨이 정확히 같을 때만 매칭 -> "티셔츠"/"맨투맨"이 섞이지 않음)

import { createServer } from 'node:http';
import { openDb } from './db.js';
import { CATEGORIES } from './lib/taxonomy.js';
import { COLOR_LABELS, COLOR_MAP } from './dedupe.js';
import { reloadBrandAliases } from './lib/brand-alias.js';
import { addBrand } from './add-brand.js';

const PORT = 5173;
const db = openDb();

const FILLER_PHRASES = [
  '찾아줘', '찾아주라', '찾아줄래', '찾아봐줘', '찾아봐', '찾아주세요', '찾아주실래요',
  '보여줘', '보여줘봐', '보여주세요', '보여줄래',
  '추천해줘', '추천해주세요', '추천좀', '추천',
  '골라줘', '골라주세요', '알려줘', '알려주세요',
  '있어', '있나요', '있을까', '있을까요', '있음',
  '해줘', '해주세요', '해줄래', '부탁해', '부탁', '줘', '좀',
];

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
  // 1순위: id/라벨/검색전용 별칭 정확 일치 ("셔츠"->shirt만, "후드"->hoodie)
  //   queryAliases는 taxonomy.json에서 검색 의도 해석에만 쓰고 classify()(상품 분류)는 안 씀.
  const exact = CATEGORIES.filter(
    (c) => c.id === s || c.label.toLowerCase() === s || (c.queryAliases || []).some((a) => a.toLowerCase() === s)
  ).map((c) => c.id);
  if (exact.length) return exact;
  // 2순위: 키워드 정확 일치 ("hoodie" 등)
  return CATEGORIES.filter((c) => c.keywords.some((k) => k.toLowerCase() === s)).map((c) => c.id);
}

// 검색창 전용 색상 별칭. COLOR_MAP(상품명 파싱용, 패션 외래어 표기 위주)에 더해
// "노란색/까만/하얀/파란/빨간" 같은 일상 구어체 형용사도 인식해야 함.
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

function resolveColorToken(token) {
  const s = token.trim().toLowerCase();
  if (!s) return null;
  return COLOR_MAP[s] || QUERY_COLOR_ALIASES[s] || null;
}

function search({ q, color, size, brand, priceMin, priceMax, inStock }) {
  const raw = (q || '').trim();
  const cleaned = stripFillers(raw);
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  let cats = [];
  let colorsFromQuery = [];
  const textTokens = [];
  for (const t of tokens) {
    const c = resolveCategoryToken(t);
    const col = resolveColorToken(t);
    if (c.length) cats.push(...c);
    else if (col) colorsFromQuery.push(col);
    else textTokens.push(t);
  }
  cats = [...new Set(cats)];
  const colors = [...new Set([...(color ? [color] : []), ...colorsFromQuery])];

  const and = [];
  const params = [];
  if (cats.length) {
    and.push('(' + cats.map(() => 'categories LIKE ?').join(' OR ') + ')');
    for (const c of cats) params.push(`%"${c}"%`);
  }
  for (const t of textTokens) {
    and.push('(brand LIKE ? OR title LIKE ? OR title_norm LIKE ?)');
    params.push(`%${t}%`, `%${t}%`, `%${t}%`);
  }
  for (const c of colors) {
    and.push('colors LIKE ?');
    params.push(`%"${c}"%`);
  }
  if (size) {
    and.push('sizes LIKE ?');
    params.push(`%"${size}"%`);
  }
  if (brand) {
    and.push('brand = ?');
    params.push(brand);
  }
  if (priceMin) {
    and.push('max_price >= ?');
    params.push(Number(priceMin));
  }
  if (priceMax) {
    and.push('min_price <= ?');
    params.push(Number(priceMax));
  }
  if (inStock) {
    and.push('in_stock = 1');
  }

  const sql = `
    SELECT * FROM product_group
    ${and.length ? 'WHERE ' + and.join(' AND ') : ''}
    ORDER BY in_stock DESC, offer_count DESC, brand ASC, title ASC
    LIMIT 300`;
  const groups = db.prepare(sql).all(...params);

  const offerStmt = db.prepare(
    'SELECT source_id, url, price, in_stock, colors, sizes FROM offer WHERE group_id = ? ORDER BY (price IS NULL), price'
  );
  return {
    query: raw,
    interpretedAs: { categories: cats, colors, keywords: textTokens },
    count: groups.length,
    results: groups.map((g) => ({
      ...g,
      categories: JSON.parse(g.categories),
      colors: JSON.parse(g.colors),
      sizes: JSON.parse(g.sizes),
      offers: offerStmt.all(g.id).map((o) => ({ ...o, colors: JSON.parse(o.colors), sizes: JSON.parse(o.sizes) })),
    })),
  };
}

function facets() {
  const rows = db.prepare('SELECT colors, sizes FROM product_group').all();
  const colors = new Set();
  const sizes = new Set();
  for (const r of rows) {
    for (const c of JSON.parse(r.colors)) colors.add(c);
    for (const s of JSON.parse(r.sizes)) sizes.add(s);
  }
  const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL'];
  return {
    colors: [...colors].sort().map((id) => ({ id, label: COLOR_LABELS[id] || id })),
    sizes: [...sizes].sort((a, b) => {
      const ia = sizeOrder.indexOf(a.toUpperCase());
      const ib = sizeOrder.indexOf(b.toUpperCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    }),
  };
}

function brandList() {
  return db
    .prepare('SELECT brand, COUNT(*) n FROM product_group GROUP BY brand ORDER BY brand ASC')
    .all();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/categories') {
      return send(res, 200, CATEGORIES.map(({ id, label }) => ({ id, label })));
    }
    if (url.pathname === '/api/brands') return send(res, 200, brandList());
    if (url.pathname === '/api/facets') return send(res, 200, facets());
    if (url.pathname === '/api/search') {
      return send(res, 200, search({
        q: url.searchParams.get('q') || '',
        color: url.searchParams.get('color') || '',
        size: url.searchParams.get('size') || '',
        brand: url.searchParams.get('brand') || '',
        priceMin: url.searchParams.get('priceMin') || '',
        priceMax: url.searchParams.get('priceMax') || '',
        inStock: url.searchParams.get('inStock') === '1',
      }));
    }
    if (url.pathname === '/api/add-brand' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.url) return send(res, 400, { status: 'error', reason: 'url 필요' });
      const result = await addBrand(body.url, {
        name: body.name,
        instagram: body.instagram,
        type: body.type || 'brand',
      });
      reloadBrandAliases(); // 새 브랜드가 별칭 사전에도 바로 반영되도록
      return send(res, 200, result);
    }
    if (url.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  const n = db.prepare('SELECT COUNT(*) n FROM product_group').get().n;
  console.log(`style-finder: http://localhost:${PORT}  (product_group ${n}건)`);
});

const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>style-finder</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, "Pretendard", "Malgun Gothic", sans-serif; color: #18181b; background: #fafafa; }
  header { position: sticky; top: 0; background: #fafafaee; backdrop-filter: blur(8px); border-bottom: 1px solid #e4e4e7; padding: 16px 20px; z-index: 10; }
  h1 { margin: 0 0 10px; font-size: 18px; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
  h1 button.link { background: none; border: 0; color: #2563eb; font-size: 13px; font-weight: 400; cursor: pointer; padding: 0; }
  .row { display: flex; gap: 8px; max-width: 980px; flex-wrap: wrap; align-items: center; }
  input[type=text] { flex: 1; min-width: 220px; padding: 10px 14px; border: 1px solid #d4d4d8; border-radius: 10px; font-size: 15px; }
  input[type=number] { width: 100px; padding: 10px 10px; border: 1px solid #d4d4d8; border-radius: 10px; font-size: 14px; }
  select { padding: 10px 10px; border: 1px solid #d4d4d8; border-radius: 10px; font-size: 14px; background: #fff; color: #18181b; max-width: 160px; }
  button { padding: 10px 18px; border: 0; border-radius: 10px; background: #18181b; color: #fff; font-size: 15px; cursor: pointer; }
  label.chk { display: flex; align-items: center; gap: 5px; font-size: 13px; color: #52525b; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; max-width: 980px; }
  .chip { padding: 5px 11px; border: 1px solid #d4d4d8; border-radius: 999px; background: #fff; font-size: 13px; cursor: pointer; }
  .chip:hover { border-color: #18181b; }
  main { padding: 20px; }
  .meta { max-width: 1200px; margin: 0 auto 14px; color: #71717a; font-size: 13px; }
  .grid { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 18px 14px; }
  .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .card img { width: 100%; aspect-ratio: 1; object-fit: cover; background: #f4f4f5; }
  .card .body { padding: 10px 11px 12px; display: flex; flex-direction: column; gap: 3px; }
  .brand { font-size: 12px; color: #71717a; }
  .title { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
  .price { font-size: 13px; margin-top: 2px; }
  .tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { font-size: 11px; color: #52525b; background: #f4f4f5; border-radius: 5px; padding: 1px 6px; }
  .sold { color: #a1a1aa; }
  .multi { color: #2563eb; font-size: 11px; margin-top: 4px; }
  a.card { text-decoration: none; color: inherit; }
  .empty { max-width: 1200px; margin: 40px auto; text-align: center; color: #a1a1aa; }
  dialog { border: 0; border-radius: 14px; padding: 0; width: min(440px, 92vw); }
  dialog::backdrop { background: rgba(0,0,0,.35); }
  .dlg-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .dlg-body h2 { margin: 0 0 4px; font-size: 16px; }
  .dlg-body input { padding: 10px 12px; border: 1px solid #d4d4d8; border-radius: 10px; font-size: 14px; }
  .dlg-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
  .dlg-row button.secondary { background: #f4f4f5; color: #18181b; }
  #addResult { font-size: 13px; padding: 8px 10px; border-radius: 8px; display: none; }
  #addResult.ok { display: block; background: #ecfdf5; color: #047857; }
  #addResult.warn { display: block; background: #fffbeb; color: #92400e; }
</style></head><body>
<header>
  <h1>style-finder <span style="font-weight:400;color:#a1a1aa">— 여러 브랜드에서 한 번에</span>
    <button class="link" onclick="addDialog.showModal()">+ 브랜드 등록</button>
  </h1>
  <div class="row">
    <input type="text" id="q" placeholder="노란색 후드집업 찾아줘, 셔츠, 브랜드명…" autofocus>
    <select id="color"><option value="">색상 전체</option></select>
    <select id="size"><option value="">사이즈 전체</option></select>
    <select id="brand"><option value="">브랜드 전체</option></select>
    <input type="number" id="priceMin" placeholder="최소가">
    <input type="number" id="priceMax" placeholder="최대가">
    <label class="chk"><input type="checkbox" id="inStock">품절 제외</label>
    <button onclick="go()">검색</button>
  </div>
  <div class="chips" id="chips"></div>
</header>
<main><div class="meta" id="meta"></div><div class="grid" id="grid"></div></main>

<dialog id="addDialog">
  <div class="dlg-body">
    <h2>브랜드 등록</h2>
    <input type="text" id="addUrl" placeholder="쇼핑몰 URL (예: brand.com)">
    <input type="text" id="addName" placeholder="표시 이름 (선택)">
    <input type="text" id="addInstagram" placeholder="인스타 핸들 (선택)">
    <div id="addResult"></div>
    <div class="dlg-row">
      <button class="secondary" onclick="addDialog.close()">닫기</button>
      <button onclick="submitAdd()">자동 판별 + 등록</button>
    </div>
  </div>
</dialog>

<script>
const won = n => n == null ? '' : '₩' + n.toLocaleString('ko-KR');
function qs() {
  const p = new URLSearchParams();
  const q = document.getElementById('q').value.trim();
  const color = document.getElementById('color').value;
  const size = document.getElementById('size').value;
  const brand = document.getElementById('brand').value;
  const priceMin = document.getElementById('priceMin').value;
  const priceMax = document.getElementById('priceMax').value;
  const inStock = document.getElementById('inStock').checked;
  if (q) p.set('q', q);
  if (color) p.set('color', color);
  if (size) p.set('size', size);
  if (brand) p.set('brand', brand);
  if (priceMin) p.set('priceMin', priceMin);
  if (priceMax) p.set('priceMax', priceMax);
  if (inStock) p.set('inStock', '1');
  return p;
}
async function go() {
  const p = qs();
  history.replaceState(0, '', p.toString() ? '?' + p.toString() : '/');
  const r = await fetch('/api/search?' + p.toString()).then(r => r.json());
  const parts = [r.count + '개'];
  if (r.interpretedAs.categories.length) parts.push('카테고리: ' + r.interpretedAs.categories.join(', '));
  if (r.interpretedAs.colors.length) parts.push('색상: ' + r.interpretedAs.colors.join(', '));
  if (r.interpretedAs.keywords.length) parts.push('검색어: ' + r.interpretedAs.keywords.join(' '));
  document.getElementById('meta').textContent = parts.join('  ·  ');
  const grid = document.getElementById('grid');
  if (!r.results.length) { grid.innerHTML = '<div class="empty">결과 없음</div>'; return; }
  grid.innerHTML = r.results.map(g => {
    const price = g.min_price === g.max_price ? won(g.min_price) : won(g.min_price) + ' ~ ' + won(g.max_price);
    const url = (g.offers[0] || {}).url || '#';
    return \`<a class="card" href="\${url}" target="_blank" rel="noopener">
      <img loading="lazy" src="\${g.image || ''}" alt="">
      <div class="body">
        <span class="brand">\${g.brand}</span>
        <span class="title \${g.in_stock ? '' : 'sold'}">\${g.title}\${g.in_stock ? '' : ' (품절)'}</span>
        <span class="price">\${price}</span>
        \${g.categories.length ? '<div class="tags">' + g.categories.map(c => '<span class="tag">' + c + '</span>').join('') + '</div>' : ''}
        \${g.offer_count > 1 ? '<span class="multi">' + g.offer_count + '개 색상/판매처</span>' : ''}
      </div></a>\`;
  }).join('');
}
async function chips() {
  const cs = await fetch('/api/categories').then(r => r.json());
  document.getElementById('chips').innerHTML = cs.map(c =>
    '<span class="chip" onclick="document.getElementById(\\'q\\').value=\\'' + c.label + '\\';go()">' + c.label + '</span>').join('');
}
async function loadFacets() {
  const f = await fetch('/api/facets').then(r => r.json());
  const colorSel = document.getElementById('color');
  for (const c of f.colors) colorSel.insertAdjacentHTML('beforeend', \`<option value="\${c.id}">\${c.label}</option>\`);
  const sizeSel = document.getElementById('size');
  for (const s of f.sizes) sizeSel.insertAdjacentHTML('beforeend', \`<option value="\${s}">\${s}</option>\`);
}
async function loadBrands() {
  const bs = await fetch('/api/brands').then(r => r.json());
  const sel = document.getElementById('brand');
  for (const b of bs) sel.insertAdjacentHTML('beforeend', \`<option value="\${b.brand}">\${b.brand} (\${b.n})</option>\`);
}
async function submitAdd() {
  const url = document.getElementById('addUrl').value.trim();
  const name = document.getElementById('addName').value.trim();
  const instagram = document.getElementById('addInstagram').value.trim();
  const out = document.getElementById('addResult');
  if (!url) return;
  out.className = ''; out.style.display = 'none';
  out.textContent = '판별 중…';
  out.style.display = 'block';
  const r = await fetch('/api/add-brand', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name, instagram }),
  }).then(r => r.json());
  if (r.status === 'ready') {
    out.className = 'ok';
    out.textContent = '등록 완료 (' + r.platform + '). 다음 수집 때 자동 포함됩니다.';
  } else {
    out.className = 'warn';
    out.textContent = '자동 판별 실패: ' + (r.reason || r.notes || '알 수 없는 플랫폼') + ' — 검토 대기로 등록됨.';
  }
}
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
for (const id of ['color', 'size', 'brand', 'inStock']) document.getElementById(id).addEventListener('change', go);
for (const id of ['priceMin', 'priceMax']) document.getElementById(id).addEventListener('change', go);
const initial = new URLSearchParams(location.search);
if (initial.get('q')) document.getElementById('q').value = initial.get('q');
if (initial.get('priceMin')) document.getElementById('priceMin').value = initial.get('priceMin');
if (initial.get('priceMax')) document.getElementById('priceMax').value = initial.get('priceMax');
if (initial.get('inStock')) document.getElementById('inStock').checked = true;
chips();
Promise.all([loadFacets(), loadBrands()]).then(() => {
  if (initial.get('color')) document.getElementById('color').value = initial.get('color');
  if (initial.get('size')) document.getElementById('size').value = initial.get('size');
  if (initial.get('brand')) document.getElementById('brand').value = initial.get('brand');
  go();
});
</script></body></html>`;
