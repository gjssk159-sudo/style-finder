// #20 홈 대시보드(넘겨 보는 카드 3장): ① 나에게 어울리는 브랜드 ② 지금 계절 추천 ③ 이번 주 내 폴더 신상.
// app.js 의 sb·currentUser·myFolderIds·allBrands 를 쓴다. 상품 목록을 새로 그릴 때(폴더가 바뀌었을 때) 다시 채운다.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const T = () => window.StyleFinderTaxonomy;

  // ── 계절: 날짜로 자동으로 바뀐다 ──
  const SEASONS = [
    { months: [11, 12, 1, 2], title: '지금 필요한<br>방한템', chips: ['패딩', '플리스', '니트', '머플러', '비니', '장갑'],
      cats: ['padding', 'long_padding', 'padding_vest', 'fleece', 'fur', 'knit', 'muffler', 'beanie', 'glove'] },
    { months: [3, 4], title: '가볍게 걸치는<br>봄 아우터', chips: ['재킷', '트렌치', '카디건', '블루종', '바람막이'],
      cats: ['jacket', 'trench', 'cardigan', 'blouson', 'windbreaker', 'trucker', 'field_jacket'] },
    { months: [5, 6, 7, 8], title: '시원하게<br>여름 필수템', chips: ['반팔', '민소매', '반바지', '샌들', '버킷햇'],
      cats: ['tshirt', 'sleeveless_top', 'shorts', 'sandals', 'swimwear', 'bucket_hat'] },
    { months: [9, 10], title: '겹쳐 입기 좋은<br>가을 레이어드', chips: ['셔츠', '니트', '카디건', '맨투맨', '코트'],
      cats: ['shirt', 'knit', 'cardigan', 'sweatshirt', 'blazer', 'coat', 'trucker'] },
  ];
  const seasonNow = (d = new Date()) => SEASONS.find((s) => s.months.includes(d.getMonth() + 1));
  window.dashSeason = seasonNow;

  const base = () => sb.from('product_group').select('id', { count: 'exact', head: true }).in('brand_id', myFolderIds).gt('min_price', 0).not('image', 'is', null).neq('image', '');

  async function fillSeason() {
    const s = seasonNow();
    $('dsMonth').textContent = (new Date().getMonth() + 1) + '월';
    $('dsTitle').innerHTML = s.title;
    $('dsChips').innerHTML = s.chips.map((c) => `<span>${esc(c)}</span>`).join('');
    const { count } = await base().overlaps('categories', s.cats);
    $('dsCount').textContent = count ? `내 폴더에서 ${count.toLocaleString('ko-KR')}개 찾았어요 →` : '내 폴더에서 찾아보기 →';
  }

  async function fillNew() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [{ count }, { data }] = await Promise.all([
      base().gte('first_seen_at', since),
      sb.from('product_group').select('image').in('brand_id', myFolderIds).gt('min_price', 0).not('image', 'is', null).neq('image', '')
        .gte('first_seen_at', since).order('first_seen_at', { ascending: false }).limit(3),
    ]);
    $('dnCount').textContent = (count || 0).toLocaleString('ko-KR');
    const imgs = (data || []).map((g) => g.image).filter((u) => /^https?:/i.test(u || ''));
    $('dnThumbs').innerHTML = imgs.map((u) => `<i><img src="${esc(typeof thumbUrl === 'function' ? thumbUrl(u) : u)}" alt="" loading="lazy" decoding="async"></i>`).join('') + '<i class="more">더 보기</i>';
  }

  // ── 나에게 어울리는 브랜드: 내 폴더(＋위시리스트) 브랜드들과 상품 종류·가격대가 비슷한데 아직 안 담은 브랜드 ──
  const PROFILE_KEY = 'sf_brand_profile';
  async function profiles() {
    const day = new Date().toISOString().slice(0, 10);
    try { const c = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); if (c && c.day === day && c.rows.length) return c.rows; } catch {}
    const rows = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from('brand_profile').select('brand_id,cat,n,med_price').range(from, from + 999);
      if (error) return null; // 요약표가 아직 없음(SQL 적용 전)
      rows.push(...data);
      if (data.length < 1000) break;
    }
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ day, rows })); } catch {}
    return rows;
  }
  function band(p) {
    if (!p) return '';
    const m = Math.floor(p / 100000);
    return m <= 0 ? '10만 원 아래' : `${m * 10}~${(m + 1) * 10}만 원대`;
  }
  // 브랜드 하나 = 종류별 비율 벡터 + 가격 중간값(종류별 중간값을 개수로 평균)
  function vectors(rows) {
    const by = new Map();
    for (const r of rows) {
      const b = by.get(r.brand_id) || { cats: new Map(), total: 0, priceSum: 0 };
      b.cats.set(r.cat, (b.cats.get(r.cat) || 0) + r.n);
      b.total += r.n;
      b.priceSum += r.med_price * r.n;
      by.set(r.brand_id, b);
    }
    for (const b of by.values()) { b.price = b.priceSum / (b.total || 1); for (const [k, v] of b.cats) b.cats.set(k, v / b.total); }
    return by;
  }
  function recommend(rows, mine, extra) {
    const vec = vectors(rows);
    const me = { cats: new Map(), price: 0, w: 0 };
    for (const id of [...mine, ...extra]) {
      const v = vec.get(id); if (!v) continue;
      for (const [k, x] of v.cats) me.cats.set(k, (me.cats.get(k) || 0) + x);
      me.price += v.price; me.w++;
    }
    if (!me.w) return null;
    me.price /= me.w;
    const norm = (m) => Math.sqrt([...m.values()].reduce((s, x) => s + x * x, 0)) || 1;
    const nMe = norm(me.cats);
    const ready = new Map(allBrands.filter((b) => b.status === 'ready').map((b) => [b.id, b]));
    const scored = [];
    for (const [id, v] of vec) {
      if (mine.includes(id) || !ready.has(id)) continue;
      let dot = 0; for (const [k, x] of v.cats) dot += x * (me.cats.get(k) || 0);
      const cos = dot / (norm(v.cats) * nMe);
      const pricePenalty = Math.exp(-Math.abs(Math.log((v.price || 1) / (me.price || 1))));
      scored.push({ id, name: ready.get(id).name, score: cos * Math.sqrt(pricePenalty) });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const topCats = [...me.cats].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => (T().labelOf(k) || k).split('/')[0]);
    return { picks: scored.slice(0, 3), why: `${topCats.join('·')} 위주 · ${band(me.price)} 브랜드를 담으셨어요` };
  }
  const initials = (n) => (String(n).match(/[0-9A-Za-z가-힣ぁ-んァ-ン一-龥]/g) || ['?']).slice(0, 2).join('').toUpperCase();

  async function fillForYou() {
    const em = (currentUser && currentUser.email) || '';
    $('dfName').textContent = em.split('@')[0] || '나';
    const rows = await profiles();
    const wishBrands = (window.cartBrandNames ? window.cartBrandNames() : [])
      .map((n) => (allBrands.find((b) => b.name === n) || {}).id).filter(Boolean);
    const r = rows && recommend(rows, myFolderIds, wishBrands);
    if (!r || !r.picks.length) {
      $('dfWhy').textContent = '브랜드를 더 담으면 취향을 분석해 추천해 드려요';
      $('dfList').innerHTML = '';
      return;
    }
    $('dfWhy').textContent = r.why;
    const { data: info } = await sb.from('brands').select('id,shop_url').in('id', r.picks.map((p) => p.id));
    const url = new Map((info || []).map((b) => [b.id, b.shop_url]));
    $('dfList').innerHTML = r.picks.map((p) => `<div class="df-row"><i aria-hidden="true">${esc(initials(p.name))}</i>` +
      (url.get(p.id) ? `<a href="${esc(url.get(p.id))}" target="_blank" rel="noopener">${esc(p.name)}</a>` : `<span>${esc(p.name)}</span>`) +
      `<button type="button" data-add-brand="${esc(p.id)}" aria-label="${esc(p.name)} 내 폴더에 담기">+ 담기</button></div>`).join('');
  }

  let lastSig = '';
  async function refresh(force) {
    const hero = $('hero');
    if (!hero) return;
    const ok = typeof currentUser !== 'undefined' && currentUser && typeof myFolderIds !== 'undefined' && myFolderIds.length && !sharedView;
    hero.hidden = !ok;
    if (!ok) return;
    const sig = myFolderIds.slice().sort().join(',');
    if (sig === lastSig && !force) return;
    lastSig = sig;
    await Promise.all([fillSeason(), fillNew(), fillForYou()].map((p) => p.catch(() => {})));
  }
  window.refreshDash = refresh;

  document.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add-brand]');
    if (add) {
      e.stopPropagation();
      add.disabled = true;
      await toggleFolder(add.dataset.addBrand, true);
      add.textContent = '담았어요';
      if (typeof renderFolderTabs === 'function') renderFolderTabs();
      go();
      return;
    }
    if (e.target.closest('[data-hero="season"]')) { if (window.applyCategoryList) window.applyCategoryList(seasonNow().cats); $('chips').scrollIntoView({ block: 'start' }); }
  });

  const grid = $('grid');
  if (grid) new MutationObserver(() => refresh()).observe(grid, { childList: true });
})();
