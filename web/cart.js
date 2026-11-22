// #15 위시리스트(D-10): 마음에 든 상품을 내 계정(cart_items)에 담아 두는 목록. 마이 → 위시리스트에서 본다. 결제는 없고, 누르면 그 쇼핑몰로 간다.
// app.js 의 sb·currentUser·openAuthDialog 를 쓴다. 표가 아직 없으면(SQL 적용 전) 버튼을 숨기고 조용히 넘어간다.
(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const won = (n) => (n == null ? '' : '₩' + Number(n).toLocaleString('ko-KR'));
  let items = [];
  let ids = new Set();
  let uid = null;
  let brandTab = '';
  const cards = new Map(); // 화면에 그린 상품: 담을 때 이름·사진·가격·링크를 같이 저장하려고

  window.cartRemember = (list) => { for (const g of list || []) cards.set(g.id, g); };

  function sync() {
    ids = new Set(items.map((x) => x.group_id).filter((x) => x != null));
    document.querySelectorAll('.cart-btn').forEach((b) => {
      const on = ids.has(+b.dataset.gid);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.setAttribute('aria-label', on ? '위시리스트에서 빼기' : '위시리스트에 담기');
    });
    document.querySelectorAll('.cart-num').forEach((c) => { c.textContent = items.length; });
    document.querySelectorAll('.cart-cnt').forEach((c) => { c.textContent = items.length > 99 ? '99+' : items.length; c.hidden = !items.length; });
    if (!$('cartView').hidden) render();
  }

  async function load() {
    if (!uid) { items = []; sync(); return; }
    const { data, error } = await sb.from('cart_items')
      .select('id,group_id,brand,title,image,price,url,added_at,product_group(in_stock,min_price,image,offer(url))')
      .order('added_at', { ascending: false });
    if (error) { root.classList.add('no-cart'); return; } // 표가 아직 없음(SQL 적용 전)
    root.classList.remove('no-cart');
    items = data || [];
    sync();
  }

  let toastTimer;
  function toast(html) {
    const t = $('cartToast');
    t.innerHTML = html;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }, 2600);
  }

  async function toggle(gid) {
    if (!uid) { openAuthDialog(); return; }
    if (ids.has(gid)) {
      const before = items;
      items = items.filter((x) => x.group_id !== gid); sync();
      const { error } = await sb.from('cart_items').delete().eq('group_id', gid);
      if (error) { items = before; sync(); toast('빼지 못했어요. 잠시 뒤 다시 해 주세요.'); return; }
      toast('위시리스트에서 뺐어요');
      return;
    }
    const g = cards.get(gid) || {};
    const row = { group_id: gid, brand: g.brand || '', title: g.title || '', image: g.image || null, price: g.min_price ?? null, url: (g.offer && g.offer[0] && g.offer[0].url) || null };
    const before = items;
    items = [{ ...row, id: -gid, added_at: new Date().toISOString(), product_group: { in_stock: g.in_stock, min_price: g.min_price, image: g.image, offer: g.offer || [] } }, ...items]; sync();
    const { data: saved, error } = await sb.from('cart_items').insert(row).select('id').single();
    if (error) { items = before; sync(); toast(/row-level|policy/i.test(error.message) ? '위시리스트는 300개까지 담을 수 있어요' : '담지 못했어요. 잠시 뒤 다시 해 주세요.'); return; }
    const it = items.find((x) => x.group_id === gid);
    if (it && saved) it.id = saved.id; // 임시 번호를 실제 번호로(빼기에 씀)
    toast('위시리스트에 담았어요 <button type="button" data-cart-open>보러 가기</button>');
  }

  async function removeItem(id, gid) {
    const before = items;
    items = items.filter((x) => x.id !== id); sync();
    const q = sb.from('cart_items').delete();
    const { error } = await (id > 0 ? q.eq('id', id) : q.eq('group_id', gid));
    if (error) { items = before; sync(); toast('빼지 못했어요. 잠시 뒤 다시 해 주세요.'); }
  }

  function render() {
    const brands = [...new Set(items.map((x) => x.brand).filter(Boolean))];
    if (brandTab && !brands.includes(brandTab)) brandTab = '';
    $('cartN').textContent = items.length + '개';
    $('cartSeg').hidden = brands.length < 2;
    $('cartSeg').innerHTML = ['', ...brands].map((b) => `<button type="button" class="${b === brandTab ? 'on' : ''}" data-b="${esc(b)}">${b ? esc(b) : '전체'}</button>`).join('');
    const list = items.filter((x) => !brandTab || x.brand === brandTab);
    if (!uid) { $('cartList').innerHTML = '<div class="cart-empty"><b>로그인하면 위시리스트를 쓸 수 있어요</b><button type="button" class="cart-go" data-cart-login>로그인</button></div>'; return; }
    if (!list.length) { $('cartList').innerHTML = '<div class="cart-empty"><b>위시리스트가 비어 있어요</b>상품 사진 오른쪽 아래<br>하트를 눌러 담아 보세요.<button type="button" class="cart-go" data-cart-home>상품 보러 가기</button></div>'; return; }
    $('cartList').innerHTML = list.map((x) => {
      const pg = x.product_group;
      const gone = x.group_id == null || !pg;
      const url = (pg && pg.offer && pg.offer[0] && pg.offer[0].url) || x.url;
      const img = (pg && pg.image) || x.image;
      const price = pg && pg.min_price != null ? pg.min_price : x.price;
      const sold = pg && pg.in_stock === false;
      const th = /^https?:/i.test(img || '') ? `<img src="${esc(typeof thumbUrl === 'function' ? thumbUrl(img) : img)}" alt="" loading="lazy" decoding="async">` : '';
      const mid = `<span class="ci-th">${th}</span><span class="ci-mid"><span class="ci-b">${esc(x.brand)}</span><span class="ci-t">${esc(x.title)}</span><span class="ci-p">${won(price)}</span>${gone ? '<span class="ci-tag">판매 끝남</span>' : sold ? '<span class="ci-tag">품절</span>' : '<span class="ci-go">쇼핑몰에서 보기 ›</span>'}</span>`;
      const body = gone || !url ? `<div class="ci-link">${mid}</div>` : `<a class="ci-link" href="${esc(url)}" target="_blank" rel="noopener">${mid}</a>`;
      return `<div class="ci${gone ? ' gone' : ''}">${body}<button type="button" class="ci-x" data-id="${x.id}" data-gid="${x.group_id ?? ''}" aria-label="${esc(x.title)} 위시리스트에서 빼기">×</button></div>`;
    }).join('');
  }

  function show() {
    $('cartToast').hidden = true; $('cartToast').classList.remove('show');
    render();
    $('cartView').hidden = false;
    $('cartView').scrollTop = 0;
    if (uid) load();
  }
  window.showCartView = show;
  window.renderCart = render;

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.cart-btn');
    if (b) { e.preventDefault(); e.stopPropagation(); toggle(+b.dataset.gid); return; }
    const x = e.target.closest('.ci-x');
    if (x) { removeItem(+x.dataset.id, x.dataset.gid ? +x.dataset.gid : null); return; }
    const s = e.target.closest('#cartSeg button');
    if (s) { brandTab = s.dataset.b; render(); return; }
    if (e.target.closest('[data-cart-open]')) { $('cartToast').hidden = true; if (window.openCartTab) window.openCartTab(); else show(); return; }
    if (e.target.closest('[data-cart-home]')) { if (window.hideAiView) window.hideAiView(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('[data-cart-login]')) openAuthDialog();
  }, true);

  // 목록을 새로 그리면 버튼 상태를 맞춘다
  const grid = $('grid');
  if (grid) new MutationObserver(() => sync()).observe(grid, { childList: true });

  sb.auth.onAuthStateChange((ev, s) => {
    const n = s?.user?.id || null;
    if (n === uid && ev !== 'INITIAL_SESSION') return;
    uid = n;
    setTimeout(load, 0);
  });
})();
