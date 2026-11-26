// #20 홈 대시보드(넘겨 보는 카드 4장, 5초마다 자동으로 넘어감): ① 나에게 어울리는 브랜드 ② 지금 계절 추천 ③ 이번 주 내 폴더 신상 ④ AI 서비스.
// app.js 의 sb·currentUser·myFolderIds·allBrands 를 쓴다. 상품 목록을 새로 그릴 때(폴더가 바뀌었을 때) 다시 채운다.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const T = () => window.StyleFinderTaxonomy;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ── 계절: 날짜로 자동으로 바뀐다 ──
  const SEASONS = [
    { months: [11, 12, 1, 2], en: 'Winter Pick', ko: '방한템', title: '지금 필요한<br>방한템', chips: ['패딩', '플리스', '니트', '머플러', '비니', '장갑'],
      cats: ['padding', 'long_padding', 'padding_vest', 'fleece', 'fur', 'knit', 'muffler', 'beanie', 'glove'] },
    { months: [3, 4], en: 'Spring Layer', ko: '봄 아우터', title: '가볍게 걸치는<br>봄 아우터', chips: ['재킷', '트렌치', '카디건', '블루종', '바람막이'],
      cats: ['jacket', 'trench', 'cardigan', 'blouson', 'windbreaker', 'trucker', 'field_jacket'] },
    { months: [5, 6, 7, 8], en: 'Summer Edit', ko: '여름 필수템', title: '시원하게<br>여름 필수템', chips: ['반팔', '민소매', '반바지', '샌들', '버킷햇'],
      cats: ['tshirt', 'sleeveless_top', 'shorts', 'sandals', 'swimwear', 'bucket_hat'] },
    { months: [9, 10], en: 'Autumn Layer', ko: '가을 레이어드', title: '겹쳐 입기 좋은<br>가을 레이어드', chips: ['셔츠', '니트', '카디건', '맨투맨', '코트'],
      cats: ['shirt', 'knit', 'cardigan', 'sweatshirt', 'blazer', 'coat', 'trucker'] },
  ];
  const seasonNow = (d = new Date()) => SEASONS.find((s) => s.months.includes(d.getMonth() + 1));
  window.dashSeason = seasonNow;

  const base = () => sb.from('product_group').select('id', { count: 'exact', head: true }).in('brand_id', myFolderIds).gt('min_price', 0).not('image', 'is', null).neq('image', '');

  // 카드 사진: 내 폴더 상품 사진을 꽉 채운다(모바일 2장·PC 4장 — 칸 수는 CSS가 정함). 없으면 원래 색 카드로.
  // 상품 사진은 대부분 세로로 긴 제품 사진이라, 한 장을 가로로 키우면 옷이 잘려서 여러 장을 나란히 놓는다.
  const heroUrl = (u) => {
    try { const x = new URL(u); return `https://i${u.length % 3}.wp.com/${x.host}${x.pathname}${x.search}${x.search ? '&' : '?'}w=720&quality=82&strip=all`; } catch { return u; }
  };
  // 사진을 먼저 불러 보고 열리는 것만 쓴다(일부 쇼핑몰은 밖에서 사진을 못 불러오게 막아 빈 칸이 생겼음). 칸 수는 열린 장수에 맞춤.
  const loadOk = (u) => new Promise((ok) => {
    const im = new Image(); let done = false;
    const end = (src) => { if (!done) { done = true; ok(src); } };
    im.onload = () => end(im.naturalWidth >= 200 ? im.src : null);
    im.onerror = () => { if (im.src !== u && !im.dataset.tried) { im.dataset.tried = '1'; im.src = u; } else end(null); };
    im.src = heroUrl(u);
    setTimeout(() => end(null), 8000);
  });
  let picSeq = 0;
  async function setPics(id, urls) {
    const box = $(id); if (!box) return;
    const my = ++picSeq;
    const ok = (await Promise.all((urls || []).slice(0, 6).map(loadOk))).filter(Boolean).slice(0, 4);
    if (box.dataset.seq && +box.dataset.seq > my) return; // 더 늦게 시작한 채우기가 이미 끝났으면 덮어쓰지 않음
    box.dataset.seq = my;
    box.dataset.n = ok.length;
    box.innerHTML = ok.map((src) => `<img src="${esc(src)}" alt="" decoding="async">`).join('');
    box.closest('.hero-slide').classList.toggle('has-bg', ok.length > 0);
  }
  const pick = (q) => q.not('image', 'is', null).neq('image', '').gt('min_price', 0).eq('in_stock', true).order('first_seen_at', { ascending: false });
  const dayNo = () => Math.floor(Date.now() / 864e5);
  // 같은 옷의 색만 다른 사진이 나란히 오지 않게 이름 앞부분이 다른 것만, 날마다 시작점을 바꿔 n장
  function choose(rows, n, shift = 0) {
    const seen = new Set();
    const uniq = (rows || []).filter((g) => /^https?:/i.test(g.image || '')).filter((g) => {
      const k = (g.brand || '') + '|' + String(g.title || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').slice(0, 14);
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    if (uniq.length <= n) return uniq.map((g) => g.image);
    const start = (dayNo() + shift) % uniq.length;
    return Array.from({ length: n }, (_, i) => uniq[(start + i) % uniq.length].image);
  }

  async function fillSeason() {
    const s = seasonNow();
    $('dsEyebrow').textContent = `${new Date().getMonth() + 1}월 · ${s.ko}`;
    $('dsTitle').textContent = s.en;
    const [{ count }, { data }] = await Promise.all([
      base().overlaps('categories', s.cats),
      pick(sb.from('product_group').select('brand,title,image').in('brand_id', myFolderIds).overlaps('categories', s.cats)).limit(40),
    ]);
    setPics('dsPics', choose(data, 6)); // 계절이 바뀌면 종류가 바뀌어 사진도 바뀌고, 같은 계절 안에서도 날마다 바뀜
    $('dsSub').textContent = `${s.chips.slice(0, 3).join('·')} 등 내 폴더에서 ${(count || 0).toLocaleString('ko-KR')}개`;
  }

  async function fillNew() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [{ count }, { data }] = await Promise.all([
      base().gte('first_seen_at', since),
      sb.from('product_group').select('brand,title,image').in('brand_id', myFolderIds).gt('min_price', 0).not('image', 'is', null).neq('image', '')
        .gte('first_seen_at', since).order('first_seen_at', { ascending: false }).limit(12),
    ]);
    const seen = new Set();
    const newest = (data || []).filter((g) => /^https?:/i.test(g.image || '') && !seen.has(g.title) && seen.add(g.title)).slice(0, 6).map((g) => g.image);
    setPics('dnPics', newest); // 가장 최근에 들어온 순서 그대로(수집이 새로 되면 바로 바뀜)
    $('dnSub').textContent = count ? `이번 주 내 폴더에 ${count.toLocaleString('ko-KR')}개 새로 들어왔어요` : '이번 주 새로 들어온 상품을 모아 봐요';
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
    const topCats = [...me.cats].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => (T().labelOf(k) || k).split('/')[0].replace(/^기타\s*/, ''));
    return { picks: scored.slice(0, 3), why: `${topCats.join('·')} 위주 · ${band(me.price)} 브랜드를 담으셨어요` };
  }
  const initials = (n) => (String(n).match(/[0-9A-Za-z가-힣ぁ-んァ-ン一-龥]/g) || ['?']).slice(0, 2).join('').toUpperCase();

  async function fillForYou() {
    const em = (currentUser && currentUser.email) || '';
    const who = em.split('@')[0] || '나';
    $('dfName').textContent = who;
    $('dfEyebrow').textContent = `${who}님 취향 분석`;
    const rows = await profiles();
    const wishBrands = (window.cartBrandNames ? window.cartBrandNames() : [])
      .map((n) => (allBrands.find((b) => b.name === n) || {}).id).filter(Boolean);
    const r = rows && recommend(rows, myFolderIds, wishBrands);
    if (!r || !r.picks.length) {
      $('dfSub').textContent = '브랜드를 더 담으면 취향을 분석해 추천해 드려요';
      $('dfWhy').textContent = '';
      $('dfList').innerHTML = '';
      setPics('dfPics', []);
      return;
    }
    $('dfSub').textContent = r.picks.map((p) => p.name).join(' · ') + ' 추천';
    $('dfWhy').textContent = r.why;
    // 추천 브랜드마다 최근 사진 한 장씩(4칸이면 1순위 브랜드 한 장 더)
    const [{ data: info }, ...shots] = await Promise.all([
      sb.from('brands').select('id,shop_url').in('id', r.picks.map((p) => p.id)),
      ...r.picks.map((p) => pick(sb.from('product_group').select('image').eq('brand_id', p.id)).limit(2)),
    ]);
    const imgs = shots.map((x) => (x.data || []).map((g) => g.image).filter((u) => /^https?:/i.test(u || '')));
    const order = [0, 1, 2].map((i) => imgs[i] && imgs[i][0]).concat([0, 1, 2].map((i) => imgs[i] && imgs[i][1])).filter(Boolean); // 브랜드마다 한 장씩 먼저, 모자라면 두 번째 사진
    setPics('dfPics', order);
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
    if (window.markHeroDots) requestAnimationFrame(window.markHeroDots);
    const sig = myFolderIds.slice().sort().join(',');
    if (sig === lastSig && !force) return;
    lastSig = sig;
    await Promise.all([fillSeason(), fillNew(), fillForYou(), fillAi()].map((p) => p.catch(() => {})));
  }
  window.refreshDash = refresh;
  // AI 카드: 내 폴더의 아우터·상의 사진(날마다 바뀜)
  async function fillAi() {
    const { data } = await pick(sb.from('product_group').select('brand,title,image').in('brand_id', myFolderIds).overlaps('categories', ['coat', 'jacket', 'blouson', 'knit', 'hoodie', 'cardigan', 'padding'])).limit(40);
    setPics('daPics', choose(data, 6, 3));
  }
  // 수집이 새로 되면 바뀌게: 화면을 켜 둔 동안 10분마다 다시 채운다
  setInterval(() => { if (!document.hidden) refresh(true); }, 10 * 60e3);

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
    if (e.target.closest('[data-hero="foryou"]')) { if (!forYouDialog.open) forYouDialog.showModal(); return; }
    if (e.target.closest('[data-hero="season"]')) { if (window.applyCategoryList) window.applyCategoryList(seasonNow().cats); $('chips').scrollIntoView({ block: 'start' }); }
  });

  // ── 넘김 점 + 5초마다 자동으로 다음 카드(손대거나 마우스를 올리면 멈춤, 움직임 줄이기 설정이면 안 넘김) ──
  const track = $('heroTrack');
  const dots = $('heroDots');
  if (track && dots) {
    const slides = () => [...track.querySelectorAll('.hero-slide')];
    dots.innerHTML = slides().map((_, i) => `<button type="button" role="tab" aria-label="${i + 1}번째 카드"></button>`).join('');
    const current = () => { const a = slides()[0], b = slides()[1]; const step = a && b ? b.offsetLeft - a.offsetLeft : 0; return step > 0 ? Math.round(track.scrollLeft / step) : 0; }; // 카드 사이 간격(한 칸 이동 거리)으로 몇 번째인지
    const go2 = (i) => { const s = slides()[i]; if (s) track.scrollTo({ left: s.offsetLeft - slides()[0].offsetLeft, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); };
    const mark = () => { const c = current(); [...dots.children].forEach((d, i) => { d.classList.toggle('on', i === c); d.setAttribute('aria-selected', i === c); }); };
    track.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
    dots.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go2([...dots.children].indexOf(b)); });
    let paused = false, resumeAt = 0;
    const pause = () => { paused = true; resumeAt = Date.now() + 8000; };
    track.addEventListener('touchstart', pause, { passive: true });
    track.addEventListener('mouseenter', () => { paused = true; resumeAt = Infinity; });
    track.addEventListener('mouseleave', () => { resumeAt = Date.now() + 2000; });
    track.addEventListener('focusin', () => { paused = true; resumeAt = Infinity; });
    track.addEventListener('focusout', () => { resumeAt = Date.now() + 2000; });
    setInterval(() => {
      if (reduceMotion.matches || document.hidden || $('hero').hidden) return;
      if (paused && Date.now() < resumeAt) return;
      paused = false;
      const n = slides().length;
      go2((current() + 1) % n);
    }, 5000);
    mark();
    window.markHeroDots = mark; // 카드가 처음 보일 때(숨겨져 있다가) 다시 표시
  }

  const grid = $('grid');
  if (grid) new MutationObserver(() => refresh()).observe(grid, { childList: true });
})();
