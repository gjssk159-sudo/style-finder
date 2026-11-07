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
    return `<a class="bf-it" href="${esc(url)}" ${link}><div class="bf-img ${g.in_stock ? '' : 'sold'}"><span class="bf-no">NO.${String(i + 1).padStart(2, '0')}</span>${g.in_stock ? '' : '<span class="bf-sold">품절</span>'}${img}</div><span class="bf-t">${esc(g.title)}</span><span class="bf-p">${price}</span></a>`;
  }

  function render() {
    const show = plainHome() && groups.length > 0;
    feed.hidden = !show;
    document.documentElement.classList.toggle('bf-on', show);
    if (!show) return;
    feed.innerHTML = groups.slice(0, MAX_BRANDS).map((gr) => `
      <section class="bf-sec">
        <div class="bf-h"><button type="button" class="bf-name" data-brand="${esc(gr.brand)}">${esc(gr.brand)}</button><button type="button" class="bf-more" data-brand="${esc(gr.brand)}">전체 보기 <i aria-hidden="true"></i></button></div>
        <div class="bf-sub">최근 들어온 상품 ${gr.items.length}</div>
        <div class="bf-row">${gr.items.slice(0, PER_BRAND).map(itemHtml).join('')}</div>
      </section>`).join('') + '<div class="bf-all">전체 상품</div>';
  }

  async function load() {
    if (typeof currentUser === 'undefined' || !currentUser || typeof myFolderIds === 'undefined') { groups = []; render(); return; }
    const key = (myFolderIds || []).join(',');
    if (!key) { groups = []; lastKey = ''; render(); return; }
    if (key === lastKey || loading) { render(); return; }
    loading = true;
    try {
      const { data, error } = await sb.from('product_group')
        .select('id,brand,brand_id,title,min_price,max_price,image,in_stock,offer!inner(url)')
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
