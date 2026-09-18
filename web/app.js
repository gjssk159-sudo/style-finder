// style-finder 프론트엔드. 백엔드 서버 없음 — 브라우저에서 Supabase에 직접 쿼리.
// 보안은 RLS(supabase/schema.sql)가 담당: 내 폴더(user_brands)는 로그인한 나만 보고 고치고,
// brands/product_group/offer는 다 같이 읽지만 쓰기는 서비스 롤(수집 파이프라인)만 가능.

const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
let currentUser = null;
let myFolderIds = []; // 내 폴더에 있는 brand_id 목록
let allBrands = [];   // "내 폴더" 다이얼로그용 전체 브랜드 목록
let currentGender = ''; // '' | 'women' | 'men' | 'unisex' — 원본에 성별 표기가 있는 상품만 걸러짐(대부분은 미상)
const PAGE_SIZE = 60;
let pageOffset = 0;
let lastTotal = 0;

function setGender(g) {
  currentGender = g;
  for (const btn of document.querySelectorAll('#genderTabs .gtab')) {
    btn.classList.toggle('active', btn.dataset.gender === g);
  }
  go();
}

const won = (n) => (n == null ? '' : '₩' + n.toLocaleString('ko-KR'));

// ---------------- 인증 (매직링크: 비밀번호 없이 이메일로 로그인) ----------------
function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (currentUser) {
    el.innerHTML = `${currentUser.email} · <button class="secondary" onclick="signOut()">로그아웃</button>`;
  } else {
    el.innerHTML = `
      <input type="email" id="loginEmail" placeholder="이메일로 로그인">
      <button onclick="sendMagicLink()">링크 받기</button>
      <span id="loginMsg" style="margin-left:6px"></span>`;
  }
}

async function sendMagicLink() {
  const email = document.getElementById('loginEmail').value.trim();
  const msg = document.getElementById('loginMsg');
  if (!email) return;
  msg.textContent = '전송 중…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  msg.textContent = error ? '오류: ' + error.message : '메일함에서 로그인 링크를 확인하세요.';
}

async function signOut() {
  await sb.auth.signOut();
}

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  renderAuthArea();
  if (currentUser) {
    await loadMyFolder();
    await loadAllBrands();
  } else {
    myFolderIds = [];
  }
  go();
});

// ---------------- 내 폴더 ----------------
async function loadMyFolder() {
  const { data, error } = await sb.from('user_brands').select('brand_id');
  if (error) { console.error(error); return; }
  myFolderIds = data.map((r) => r.brand_id);
}

async function loadAllBrands() {
  // 'excluded'만 빼고 다 가져옴 — pending/needs_review도 내 폴더 목록엔 보여야
  // 방금 등록한 브랜드가 "등록은 됐는데 목록엔 안 보임" 처럼 느껴지지 않음.
  const { data, error } = await sb
    .from('brands')
    .select('id,name,type,status')
    .neq('status', 'excluded')
    .order('name');
  if (error) { console.error(error); return; }
  allBrands = data;
  renderBrandFilter();
}

function renderBrandFilter() {
  const sel = document.getElementById('brand');
  const current = sel.value;
  sel.innerHTML = '<option value="">브랜드 전체</option>';
  // 검색 필터용 드롭다운은 실제 상품이 있는 ready 브랜드만
  const mine = allBrands.filter((b) => b.status === 'ready' && myFolderIds.includes(b.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const b of mine) sel.insertAdjacentHTML('beforeend', `<option value="${b.name}">${b.name}</option>`);
  sel.value = current;
}

function renderFolderList() {
  const q = (document.getElementById('folderSearch').value || '').toLowerCase();
  const list = document.getElementById('folderList');
  if (!currentUser) {
    list.innerHTML = '<div style="padding:12px;color:#a1a1aa">로그인하면 폴더를 만들 수 있어요.</div>';
    return;
  }
  const filtered = allBrands.filter((b) => b.name.toLowerCase().includes(q));
  list.innerHTML = filtered
    .map((b) => {
      const checked = myFolderIds.includes(b.id) ? 'checked' : '';
      const typeLabel = b.type === 'select_shop' ? '<span class="fbrand">편집샵</span>' : '';
      const statusLabel = b.status !== 'ready'
        ? `<span class="fbrand">${b.status === 'pending' ? '처리 중' : '수집 준비 중'}</span>`
        : '';
      return `<label class="folderRow">
        <input type="checkbox" data-brand="${b.id}" ${checked} onchange="toggleFolder('${b.id}', this.checked)">
        <span class="fname">${b.name}</span> ${typeLabel} ${statusLabel}
      </label>`;
    })
    .join('') || '<div style="padding:12px;color:#a1a1aa">결과 없음</div>';
}

async function toggleFolder(brandId, add) {
  const msg = document.getElementById('folderMsg');
  if (add) {
    const { error } = await sb.from('user_brands').insert({ user_id: currentUser.id, brand_id: brandId });
    if (error) { msg.className = 'warn'; msg.textContent = error.message; return; }
    myFolderIds.push(brandId);
  } else {
    const { error } = await sb.from('user_brands').delete().eq('brand_id', brandId);
    if (error) { msg.className = 'warn'; msg.textContent = error.message; return; }
    myFolderIds = myFolderIds.filter((id) => id !== brandId);
  }
  msg.className = 'ok';
  msg.textContent = `내 폴더: ${myFolderIds.length}개 브랜드`;
  renderBrandFilter();
}

// ---------------- 브랜드 등록 (실시간 판별 없이 "등록 요청"만 접수 — 처리는 백엔드에서) ----------------
function slugify(hostname) {
  return hostname.replace(/^www\./, '').replace(/\.(com|co\.kr|kr|link|net|store|shop)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function submitAdd() {
  const out = document.getElementById('addResult');
  if (!currentUser) { out.className = 'warn'; out.textContent = '로그인 먼저 해주세요.'; out.style.display = 'block'; return; }
  const urlInput = document.getElementById('addUrl').value.trim();
  const name = document.getElementById('addName').value.trim();
  const instagram = document.getElementById('addInstagram').value.trim();
  if (!urlInput) return;

  let shopUrl;
  try { shopUrl = new URL(/^https?:\/\//i.test(urlInput) ? urlInput : `https://${urlInput}`).origin; }
  catch { out.className = 'warn'; out.textContent = 'URL 형식이 이상해요.'; out.style.display = 'block'; return; }

  const id = slugify(new URL(shopUrl).hostname);
  out.style.display = 'block';
  out.className = '';
  out.textContent = '등록 중…';

  const { error: e1 } = await sb.from('brands').upsert(
    { id, name: name || id, name_en: name || id, type: 'brand', instagram: instagram || null, shop_url: shopUrl, platform: 'unknown', status: 'pending', added_by: currentUser.id },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (e1) { out.className = 'warn'; out.textContent = e1.message; return; }

  const { error: e2 } = await sb.from('user_brands').insert({ user_id: currentUser.id, brand_id: id });
  if (e2 && !String(e2.message).includes('duplicate')) { out.className = 'warn'; out.textContent = e2.message; return; }

  myFolderIds.push(id);
  out.className = 'ok';
  out.textContent = '등록 요청 접수! 자동 판별 후 곧 검색에 반영돼요. (이미 있던 브랜드면 내 폴더에 바로 추가됨)';
  await loadAllBrands();
}

// ---------------- 검색 ----------------
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
  if (currentGender) p.set('gender', currentGender);
  return p;
}

function buildQuery(offset) {
  const raw = document.getElementById('q').value;
  const { categories, colors: colorsFromQuery, keywords } = window.StyleFinderTaxonomy.parseQuery(raw);
  const color = document.getElementById('color').value;
  const colors = [...new Set([...(color ? [color] : []), ...colorsFromQuery])];
  const size = document.getElementById('size').value;
  const brand = document.getElementById('brand').value;
  const priceMin = document.getElementById('priceMin').value;
  const priceMax = document.getElementById('priceMax').value;
  const inStock = document.getElementById('inStock').checked;

  let query = sb
    .from('product_group')
    // offer!inner: 판매 링크(offer)가 하나도 없는 유령 상품은 아예 결과에서 제외 (클릭해도 갈 곳 없는 카드 방지)
    .select('id,brand,title,title_norm,categories,colors,sizes,min_price,max_price,image,in_stock,offer_count,offer!inner(source_id,url,price,in_stock)', { count: 'exact' })
    .in('brand_id', myFolderIds)
    .order('in_stock', { ascending: false })
    .order('offer_count', { ascending: false })
    .order('brand')
    .order('title')
    .range(offset, offset + PAGE_SIZE - 1);

  if (categories.length) query = query.overlaps('categories', categories);
  if (colors.length) query = query.overlaps('colors', colors);
  if (currentGender) query = query.eq('gender', currentGender);
  if (size) query = query.contains('sizes', [size]);
  if (brand) query = query.eq('brand', brand);
  if (priceMin) query = query.gte('max_price', Number(priceMin));
  if (priceMax) query = query.lte('min_price', Number(priceMax));
  if (inStock) query = query.eq('in_stock', true);
  for (const kw of keywords) {
    query = query.or(`brand.ilike.%${kw}%,title.ilike.%${kw}%,title_norm.ilike.%${kw}%`);
  }
  return { query, categories, colors, keywords };
}

// 어떤 이미지는 로딩이 성공도 실패도 아닌 채로 계속 멈춰있는 경우가 있어서(브라우저/네트워크 이슈),
// 일정 시간 안에 안 끝나면 그냥 빈 박스로 넘어가게 강제 타임아웃을 건다.
function armImageTimeouts(container) {
  for (const img of container.querySelectorAll('img:not([data-armed])')) {
    img.dataset.armed = '1';
    const t = setTimeout(() => { if (!img.complete) img.remove(); }, 8000);
    img.addEventListener('load', () => clearTimeout(t), { once: true });
    img.addEventListener('error', () => clearTimeout(t), { once: true });
  }
}

function cardsHtml(data) {
  return data
    .map((g) => {
      const price = g.min_price === g.max_price ? won(g.min_price) : won(g.min_price) + ' ~ ' + won(g.max_price);
      const url = (g.offer && g.offer[0] && g.offer[0].url) || '#';
      const tags = (g.categories || []).map((c) => `<span class="tag">${c}</span>`).join('');
      return `<a class="card" href="${url}" target="_blank" rel="noopener">
        <div class="imgwrap ${g.in_stock ? '' : 'sold'}">
          ${g.image ? `<img src="${g.image}" alt="" onerror="this.remove()" onload="if(this.naturalWidth<200)this.remove()">` : ''}
          ${g.in_stock ? '' : '<span class="badge">품절</span>'}
        </div>
        <div class="body">
          <span class="brand">${g.brand}</span>
          <span class="title">${g.title}</span>
          <span class="price">${price}</span>
          ${tags ? `<div class="tags">${tags}</div>` : ''}
          ${g.offer_count > 1 ? `<span class="multi">${g.offer_count}개 색상/판매처</span>` : ''}
        </div></a>`;
    })
    .join('');
}

function updateMoreButton(shownCount) {
  const wrap = document.getElementById('moreWrap');
  const btn = document.getElementById('moreBtn');
  if (lastTotal > shownCount) {
    wrap.style.display = 'block';
    btn.textContent = `더 보기 (${shownCount}/${lastTotal})`;
  } else {
    wrap.style.display = 'none';
  }
}

async function go() {
  const grid = document.getElementById('grid');
  const meta = document.getElementById('meta');
  const p = qs();
  history.replaceState(0, '', p.toString() ? '?' + p.toString() : location.pathname);
  pageOffset = 0;

  if (!currentUser) {
    meta.textContent = '';
    grid.innerHTML = '<div class="empty">로그인하면 내 폴더에 등록한 브랜드에서 검색할 수 있어요.<br>위에서 이메일로 로그인해보세요.</div>';
    document.getElementById('moreWrap').style.display = 'none';
    return;
  }
  if (myFolderIds.length === 0) {
    meta.textContent = '';
    grid.innerHTML = '<div class="empty">내 폴더가 비어있어요.<br>"내 폴더"에서 브랜드를 추가하거나 "+ 브랜드 등록"으로 새 브랜드를 등록해보세요.</div>';
    document.getElementById('moreWrap').style.display = 'none';
    return;
  }

  const { query, categories, colors, keywords } = buildQuery(pageOffset);
  const { data, error, count } = await query;
  if (error) { meta.textContent = '오류: ' + error.message; grid.innerHTML = ''; return; }

  lastTotal = count || 0;
  const parts = [`${lastTotal}개`];
  if (categories.length) parts.push('카테고리: ' + categories.join(', '));
  if (colors.length) parts.push('색상: ' + colors.join(', '));
  if (keywords.length) parts.push('검색어: ' + keywords.join(' '));
  meta.textContent = parts.join('  ·  ');

  if (!data.length) { grid.innerHTML = '<div class="empty">결과 없음</div>'; document.getElementById('moreWrap').style.display = 'none'; return; }
  grid.innerHTML = cardsHtml(data);
  armImageTimeouts(grid);
  updateMoreButton(data.length);
}

async function loadMore() {
  pageOffset += PAGE_SIZE;
  const { query } = buildQuery(pageOffset);
  const { data, error } = await query;
  if (error) return;
  const grid = document.getElementById('grid');
  grid.insertAdjacentHTML('beforeend', cardsHtml(data));
  armImageTimeouts(grid);
  updateMoreButton(pageOffset + data.length);
}

function renderChips() {
  document.getElementById('chips').innerHTML = window.StyleFinderTaxonomy.CATEGORIES
    .map((c) => `<span class="chip" onclick="document.getElementById('q').value='${c.label}';go()">${c.label}</span>`)
    .join('');
}

async function loadFacetSelectors() {
  const colorSel = document.getElementById('color');
  for (const [id, label] of Object.entries(window.StyleFinderTaxonomy.COLOR_LABELS)) {
    colorSel.insertAdjacentHTML('beforeend', `<option value="${id}">${label}</option>`);
  }
  const sizeSel = document.getElementById('size');
  for (const s of ['XS', 'S', 'M', 'L', 'XL', 'XXL']) sizeSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
}

// ---------------- 초기화 ----------------
document.getElementById('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
for (const id of ['color', 'size', 'brand', 'inStock']) document.getElementById(id).addEventListener('change', go);
for (const id of ['priceMin', 'priceMax']) document.getElementById(id).addEventListener('change', go);

(async () => {
  await window.StyleFinderTaxonomy.loadTaxonomy();
  renderChips();
  await loadFacetSelectors();

  const initial = new URLSearchParams(location.search);
  if (initial.get('q')) document.getElementById('q').value = initial.get('q');
  if (initial.get('color')) document.getElementById('color').value = initial.get('color');
  if (initial.get('size')) document.getElementById('size').value = initial.get('size');
  if (initial.get('priceMin')) document.getElementById('priceMin').value = initial.get('priceMin');
  if (initial.get('priceMax')) document.getElementById('priceMax').value = initial.get('priceMax');
  if (initial.get('inStock')) document.getElementById('inStock').checked = true;
  if (initial.get('gender')) {
    currentGender = initial.get('gender');
    for (const btn of document.querySelectorAll('#genderTabs .gtab')) {
      btn.classList.toggle('active', btn.dataset.gender === currentGender);
    }
  }

  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  renderAuthArea();
  if (currentUser) {
    await loadMyFolder();
    await loadAllBrands();
    if (initial.get('brand')) document.getElementById('brand').value = initial.get('brand');
  }
  go();
})();
