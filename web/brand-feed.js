// 홈 "브랜드마다 최근 상품 한 줄" (T-04 2단계, 틀 A D-5 · 룩북형 D-6)
// - 로그인했고 검색·브랜드·분류·필터 조건이 하나도 없을 때만 보인다. 조건이 걸리면 숨기고 기존 결과 목록만 보인다.
// - 데이터는 담은 브랜드의 최근 상품을 한 번에 받아(요청 1번) 브랜드별로 나눈다. 쓰기 요청은 없다.
// - 브랜드 이름·"전체 보기"를 누르면 기존 pickBrand()(그 브랜드만 보기)를 그대로 쓴다.
// app.js 의 전역(sb, currentUser, sharedView, myFolderIds, RECENT_COL, thumbUrl, won, OPEN_IN_PLACE, pickBrand, qs)을 읽기만 한다.
(function () {
  const feed = document.getElementById('brandFeed');
  if (!feed) return;
  const MAX_BRANDS = 6, PER_BRAND = 8, FETCH = 160;
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let lastKey = '', groups = [], loading = false;
  window.brandThumbs = window.brandThumbs || {};

  // 조건이 하나라도 걸려 있으면(검색어·브랜드·분류·색·사이즈·가격·품절 제외·공유 폴더) 숨긴다. 정렬·페이지는 상관없다.
  function plainHome() {
    if (typeof currentUser === 'undefined' || !currentUser || (typeof sharedView !== 'undefined' && sharedView)) return false;
    const p = qs();
    p.delete('sort'); p.delete('p');
    return [...p.keys()].length === 0;
  }

  function itemHtml(g, i) {
    const price = g.min_price === g.max_price ? won(g.min_price) : won(g.min_price) + '~';
    const url = (g.offer && g.offer[0] && g.offer[0].url) || '#';
    const link = OPEN_IN_PLACE ? '' : 'target="_blank" rel="noopener"';
    const img = /^https?:/i.test(g.image || '') ? `<img src="${thumbUrl(g.image)}" data-orig="${esc(g.image)}" alt="" loading="lazy" decoding="async" onerror="imgFallback(this)">` : '';
    // E3: 사진 위 두 줄 캡션(NO.01 / 브랜드), E4: 흰 칸에 사진을 자르지 않고
    return `<a class="bf-it" href="${esc(url)}" ${link}><span class="bf-cap"><b>NO.${String(i + 1).padStart(2, '0')}</b>${esc(catOf(g))}</span><div class="bf-img ${g.in_stock ? '' : 'sold'}">${g.in_stock ? '' : '<span class="bf-sold">품절</span>'}${img}</div><span class="bf-t">${esc(g.title)}</span><span class="bf-p">${price}</span></a>`;
  }

  // 캡션 둘째 줄: 레퍼런스의 '2025 FW Collection' 자리 → 상품 분류(아우터·상의…)
  function catOf(g) {
    try { const c = (g.categories || [])[0]; return c ? window.StyleFinderTaxonomy.labelOf(c) : g.brand; } catch { return g.brand; }
  }

  // E5: 첫 브랜드는 큰 사진 + 옆에 번호·이름·가격·작은 사진(비대칭), 나머지는 한 줄
  function featureHtml(gr) {
    const [a, b] = gr.items;
    const url = (g) => esc((g.offer && g.offer[0] && g.offer[0].url) || '#');
    const link = OPEN_IN_PLACE ? '' : 'target="_blank" rel="noopener"';
    const pic = (g) => (/^https?:/i.test(g.image || '') ? `<img src="${thumbUrl(g.image)}" data-orig="${esc(g.image)}" alt="" loading="lazy" decoding="async" onerror="imgFallback(this)">` : '');
    const price = (g) => (g.min_price === g.max_price ? won(g.min_price) : won(g.min_price) + '~');
    return `<div class="bf-feat">
        <a class="bf-big bf-img ${a.in_stock ? '' : 'sold'}" href="${url(a)}" ${link}>${pic(a)}</a>
        <div class="bf-side">
          <span class="bf-cap"><b>NO.01</b>${esc(catOf(a))}</span>
          <a class="bf-side-t" href="${url(a)}" ${link}>${esc(a.title)}</a>
          <span class="bf-p">${price(a)}</span>
          ${b ? `<a class="bf-small bf-img ${b.in_stock ? '' : 'sold'}" href="${url(b)}" ${link}>${pic(b)}</a><span class="bf-cap bf-cap2"><b>NO.02</b><span>${esc(b.title)}</span></span>` : ''}
        </div>
      </div>`;
  }

  function render() {
    const show = plainHome() && groups.length > 0;
    feed.hidden = !show;
    document.documentElement.classList.toggle('bf-on', show);
    if (!show) return;
    // E1: 가늘고 넓은 영문 대문자 제목, E2: 꺾쇠 소제목과 짧은 줄
    feed.innerHTML = '<div class="bf-top"><h2 class="disp">NEW IN</h2><p class="bf-brk">【 내 브랜드의 최근 상품 】</p></div>' +
      groups.slice(0, MAX_BRANDS).map((gr, s) => `
      <section class="bf-sec">
        <div class="bf-h"><button type="button" class="bf-name" data-brand="${esc(gr.brand)}">${esc(gr.brand)}</button><button type="button" class="bf-more" data-brand="${esc(gr.brand)}">전체 보기 <i aria-hidden="true"></i></button></div>
        <div class="bf-sub"><span aria-hidden="true">—</span> 최근 들어온 상품 ${gr.items.length}</div>
        ${s === 0 && gr.items.length >= 2 ? featureHtml(gr) + `<div class="bf-row">${gr.items.slice(2, PER_BRAND).map((g, i) => itemHtml(g, i + 2)).join('')}</div>` : `<div class="bf-row">${gr.items.slice(0, PER_BRAND).map(itemHtml).join('')}</div>`}
      </section>`).join('') + '<div class="bf-all"><h2 class="disp">ALL ITEMS</h2><p class="bf-brk">【 내 브랜드 전체 상품 】</p></div>';
  }

  // E6: 로고 줄 오른쪽 작은 날짜 라벨
  const dateEl = document.getElementById('hdrDate');
  if (dateEl) { const d = new Date(); dateEl.textContent = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()]}`; }

  async function load() {
    if (typeof currentUser === 'undefined' || !currentUser || typeof myFolderIds === 'undefined') { groups = []; render(); return; }
    const key = (myFolderIds || []).join(',');
    if (!key) { groups = []; lastKey = ''; render(); return; }
    if (key === lastKey || loading) { render(); return; }
    loading = true;
    try {
      const { data, error } = await sb.from('product_group')
        .select('id,brand,brand_id,title,categories,min_price,max_price,image,in_stock,offer!inner(url)')
        .in('brand_id', myFolderIds)
        .order(RECENT_COL, { ascending: false })
        .limit(FETCH);
      if (error) throw error;
      const by = new Map();
      for (const g of data || []) {
        if (!by.has(g.brand)) by.set(g.brand, []);
        by.get(g.brand).push(g);
      }
      groups = [...by].map(([brand, items]) => ({ brand, items })); // 최근 상품이 있는 브랜드 순서
      window.brandThumbs = {};
      for (const gr of groups) { const im = gr.items.find((x) => /^https?:/i.test(x.image || '')); if (im) window.brandThumbs[gr.brand] = thumbUrl(im.image); }
      lastKey = key;
      if (typeof window.buildFolderCard === 'function') window.buildFolderCard();
    } catch (e) {
      console.error(e);
      groups = [];
    } finally { loading = false; }
    render();
  }

  feed.addEventListener('click', (e) => {
    const b = e.target.closest('[data-brand]');
    if (!b) return;
    pickBrand(b.dataset.brand);
    window.scrollTo({ top: 0 });
  });

  // 폴더·브랜드 목록이 바뀌면 다시 불러오고, 검색·필터 결과가 그려질 때마다 보일지 다시 정한다.
  const brandSel = document.getElementById('brand');
  if (brandSel) new MutationObserver(load).observe(brandSel, { childList: true });
  const meta = document.getElementById('meta');
  if (meta) new MutationObserver(render).observe(meta, { childList: true, characterData: true, subtree: true });
  window.addEventListener('popstate', render);
  window.reloadBrandFeed = () => { lastKey = ''; load(); };
  setTimeout(load, 1200);
})();
