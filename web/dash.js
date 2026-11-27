// #20 홈 대시보드(넘겨 보는 카드 4장, 5초마다 자동으로 넘어감): ① 나에게 어울리는 브랜드 ② 지금 계절 추천 ③ 이번 주 내 폴더 신상 ④ AI 서비스.
// app.js 의 sb·currentUser·myFolderIds·allBrands 를 쓴다. 상품 목록을 새로 그릴 때(폴더가 바뀌었을 때) 다시 채운다.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const T = () => window.StyleFinderTaxonomy;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ── 계절: 날짜로 자동으로 바뀐다 ──
  const SEASONS = [
    { months: [11, 12, 1, 2], en: 'Winter Pick', ko: '방한템', word: '겨울', title: '지금 필요한<br>방한템', chips: ['패딩', '퍼·무스탕', '플리스', '머플러', '비니', '장갑'],
      cats: ['padding', 'long_padding', 'padding_vest', 'fur', 'fleece', 'muffler', 'beanie', 'glove'], pics: ['1484081064812-86e90e107fa8', '1706765779494-2705542ebe74', '1770068780780-e000a31d10a3'] }, // 니트처럼 넓은 종류는 빼고 방한에 딱 맞는 것만(#20 사용자 요청)
    { months: [3, 4], en: 'Spring Layer', ko: '봄 아우터', word: '봄', title: '가볍게 걸치는<br>봄 아우터', chips: ['재킷', '트렌치', '카디건', '블루종', '바람막이'],
      cats: ['jacket', 'trench', 'cardigan', 'blouson', 'windbreaker', 'trucker', 'field_jacket'], pics: ['1645996831587-a9d4a73586f9', '1693129499971-ae047f40ca70', '1645819134444-6275dadf2299'] },
    { months: [5, 6, 7, 8], en: 'Summer Edit', ko: '여름 필수템', word: '여름', title: '시원하게<br>여름 필수템', chips: ['반팔', '민소매', '반바지', '샌들', '버킷햇'],
      cats: ['tshirt', 'sleeveless_top', 'shorts', 'sandals', 'swimwear', 'bucket_hat'], pics: ['1538329972958-465d6d2144ed', '1557924760-b14a6d4a4ef3', '1728280050425-ba1695a9c9a6'] },
    { months: [9, 10], en: 'Autumn Layer', ko: '가을 레이어드', word: '가을', title: '겹쳐 입기 좋은<br>가을 레이어드', chips: ['셔츠', '니트', '카디건', '맨투맨', '코트'],
      cats: ['shirt', 'knit', 'cardigan', 'sweatshirt', 'blazer', 'coat', 'trucker'], pics: ['1700150662401-9b96a5fedfbb', '1700150615736-e90e9037b8e6', '1645561305502-63a9ba09ab09'] },
  ];
  const seasonNow = (d = new Date()) => SEASONS.find((s) => s.months.includes(d.getMonth() + 1));
  window.dashSeason = seasonNow;

  const base = () => sb.from('product_group').select('id', { count: 'exact', head: true }).in('brand_id', myFolderIds).gt('min_price', 0).not('image', 'is', null).neq('image', '');

  // 카드는 사진 없이 그래픽(#20, 사용자 선택 2026-11-27). 여기서는 글자와 숫자만 채운다.
  let seasonPick = [];
  // 카드 사진: 무료 화보 사진(Unsplash, 상업 사용 가능). 칸마다 3장이 천천히 확대되며 바뀐다.
  const PICS = {
    dfPics: ['1760337741510-1a4661e036fa', '1645561305502-63a9ba09ab09', '1700150615736-e90e9037b8e6'],
    dnPics: ['1540221652346-e5dd6b50f3e7', '1441984904996-e0b6ba687e04', '1551488831-00ddcb6c6bd3'],
    daPics: ['1675518334039-960154e902c0', '1713810186776-da901a67b444', '1662532577856-e8ee8b138a8b'],
  };
  const picUrl = (id) => `https://images.unsplash.com/photo-${id}?w=900&q=70&auto=format&fit=crop`;
  function setPics(id, ids) {
    const box = $(id); if (!box || box.dataset.ids === ids.join()) return;
    box.dataset.ids = ids.join();
    box.innerHTML = ids.map((x, i) => `<img${i === 0 ? ' class="on"' : ''} src="${picUrl(x)}" alt="" decoding="async"${i ? ' loading="lazy"' : ''}>`).join('');
    clearInterval(box._t);
    if (reduceMotion.matches) return;
    let k = 0;
    box._t = setInterval(() => { const im = box.querySelectorAll('img'); if (im.length < 2) return; im[k].classList.remove('on'); k = (k + 1) % im.length; void im[k].offsetWidth; im[k].classList.add('on'); }, 4500);
  } // (예전 "골라 준 N선" 자리) 비어 있으면 계절 카드는 계절 종류 전체로 거른다

  async function fillSeason() {
    const s = seasonNow();
    $('dsEyebrow').textContent = s.title.replace('<br>', ' '); // 예: 지금 필요한 방한템
    setPics('dsPics', s.pics);
    if ($('dsWord')) $('dsWord').textContent = s.word;
    // 계절 움직임: 겨울엔 눈
    $('dsFx').innerHTML = s.ko === '방한템' ? Array.from({ length: 26 }, (_, i) => { const z = (2 + (i % 3) * 1.6).toFixed(1); return `<i style="left:${(i * 37) % 100}%;width:${z}px;height:${z}px;--dx:${((i % 5) - 2) * 12}px;animation-duration:${6 + (i % 5)}s;animation-delay:-${(i * 0.41).toFixed(2)}s"></i>`; }).join('') : '';
    const { count } = await base().overlaps('categories', s.cats);
    seasonPick = [];
    $('dsTitle').textContent = s.en.split(' ')[0]; // 예: Winter
    $('dsSub').textContent = `${s.chips.slice(0, 3).join('·')} 등 내 폴더에서 ${(count || 0).toLocaleString('ko-KR')}개`;
  }
  window.dashSeasonPick = () => seasonPick;


  async function fillNew() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count } = await base().gte('first_seen_at', since);
    $('dnBig').textContent = (count || 0).toLocaleString('ko-KR');
    $('dnSub').textContent = count ? `최근 7일 동안 내 폴더 브랜드에서 새로 모은 상품 ${count.toLocaleString('ko-KR')}개` : '최근 7일 동안 내 폴더 브랜드에서 새로 모은 상품';
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
      if (!ready.has(id)) continue;
      let dot = 0; for (const [k, x] of v.cats) dot += x * (me.cats.get(k) || 0);
      const cos = dot / (norm(v.cats) * nMe);
      const pricePenalty = Math.exp(-Math.abs(Math.log((v.price || 1) / (me.price || 1))));
      // 이 브랜드만의 이유: 나와 겹치는 종류(둘 다 많이 가진 것) 2개 + 가격대 비교
      const shared = [...v.cats].map(([k, x]) => [k, Math.min(x, me.cats.get(k) || 0)]).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
      scored.push({ id, name: ready.get(id).name, score: cos * Math.sqrt(pricePenalty), own: mine.includes(id), shared, price: v.price });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const label = (k) => (T().labelOf(k) || k).split('/')[0].replace(/^기타\s*/, '');
    const topCats = [...me.cats].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => label(k));
    // 아직 안 담은 브랜드 먼저. 거의 모든 브랜드를 담았으면 폴더 안에서 취향에 가장 가까운 브랜드로 채워 늘 3곳
    const picks = [...scored.filter((x) => !x.own), ...scored.filter((x) => x.own)].slice(0, 3);
    for (const p of picks) {
      const r = Math.log((p.price || 1) / (me.price || 1));
      const won = `중간 ${Math.max(1, Math.round((p.price || 0) / 10000))}만 원`;
      const priceTxt = Math.abs(r) < 0.25 ? `가격대가 비슷합니다(${won})` : r < 0 ? `조금 더 저렴합니다(${won})` : `조금 더 높은 가격대입니다(${won})`;
      const names = p.shared.map(label).join('·');
      const last = names.charCodeAt(names.length - 1);
      const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 ? '을' : '를'; // 받침 있으면 을
      p.reason = p.shared.length ? `${names}${josa} 주로 팔고, ${priceTxt}` : priceTxt;
    }
    return { picks, tags: [...topCats, band(me.price)] };
  }

  async function fillForYou() {
    const em = (currentUser && currentUser.email) || '';
    const who = em.split('@')[0] || '나';
    $('dfName').textContent = who;
    const rows = await profiles();
    const wishBrands = (window.cartBrandNames ? window.cartBrandNames() : [])
      .map((n) => (allBrands.find((b) => b.name === n) || {}).id).filter(Boolean);
    const r = rows && recommend(rows, myFolderIds, wishBrands);
    if (!r || !r.picks.length) {
      $('dfSub').textContent = '브랜드를 더 담으시면 취향을 분석해 추천해 드립니다';
      $('dfChip').hidden = true;
      $('dfWhy').textContent = '';
      $('dfList').innerHTML = '';
      return;
    }
    $('dfSub').textContent = r.picks.map((p) => p.name).join(' · ');
    const pct = Math.round((r.picks[0].score || 0) * 100);
    $('dfMatch').textContent = pct + '%';
    $('dfChip').hidden = pct < 50; // 점수가 낮으면 표시하지 않음
    $('dfWhy').innerHTML = '<small>내 취향</small>' + r.tags.map((t) => `<span>${esc(t)}</span>`).join('');
    // 사진은 이유에 적은 종류(겹치는 종류)의 상품으로(이유와 사진이 맞게)
    const shots = await Promise.all(r.picks.map((p) => (p.shared.length ? sb.from('product_group').select('image').overlaps('categories', p.shared) : sb.from('product_group').select('image')).eq('brand_id', p.id).gt('min_price', 0).eq('in_stock', true)
      .not('image', 'is', null).neq('image', '').not('image', 'like', '%echosting.cafe24.com/thumb/%').order('first_seen_at', { ascending: false }).limit(4)));
    $('dfList').innerHTML = r.picks.map((p, i) => {
      const imgs = ((shots[i] && shots[i].data) || []).map((g) => g.image).filter((u) => /^https?:/i.test(u || ''));
      const src = (u) => (typeof thumbUrl === 'function' ? thumbUrl(u) : u);
      return `<div class="df-card"><div class="df-head"><b>${esc(p.name)}</b>${p.score >= 0.5 ? `<span class="df-pct">취향 일치 ${Math.round(p.score * 100)}%</span>` : ''}</div>` +
        `<p class="df-reason">${esc(p.reason)}</p>` +
        (imgs.length ? `<button type="button" class="df-shots" data-see-brand="${esc(p.name)}" aria-label="${esc(p.name)} 상품 보기">${imgs.map((u) => `<img src="${esc(src(u))}" alt="" loading="lazy" decoding="async">`).join('')}</button>` : '') +
        `<div class="df-act"><button type="button" data-see-brand="${esc(p.name)}">상품 보기</button>` +
        (p.own ? '<button type="button" class="own" disabled>담겨 있음</button>' : `<button type="button" data-add-brand="${esc(p.id)}" aria-label="${esc(p.name)} 내 폴더에 담기">+ 담기</button>`) + '</div></div>';
    }).join('');
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
    for (const k of Object.keys(PICS)) setPics(k, PICS[k]);
    await Promise.all([fillSeason(), fillNew(), fillForYou()].map((p) => p.catch(() => {})));
  }
  window.refreshDash = refresh;
  // 수집이 새로 되면 바뀌게: 화면을 켜 둔 동안 10분마다 다시 채운다
  setInterval(() => { if (!document.hidden) refresh(true); }, 10 * 60e3);

  document.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add-brand]');
    if (add) {
      e.stopPropagation();
      add.disabled = true;
      await toggleFolder(add.dataset.addBrand, true);
      add.textContent = '담았습니다';
      if (typeof renderFolderTabs === 'function') renderFolderTabs();
      go();
      return;
    }
    const see = e.target.closest('[data-see-brand]');
    if (see) { forYouDialog.close(); if (typeof pickBrand === 'function') pickBrand(see.dataset.seeBrand); $('chips').scrollIntoView({ block: 'start' }); return; }
    if (e.target.closest('[data-hero="foryou"]')) { if (!forYouDialog.open) forYouDialog.showModal(); return; }
    if (e.target.closest('[data-hero="season"]')) { if (seasonPick.length && window.showCurated) window.showCurated(`${seasonNow().ko} ${seasonPick.length}선`, seasonPick); else if (window.applyCategoryList) window.applyCategoryList(seasonNow().cats); $('chips').scrollIntoView({ block: 'start' }); }
  });

  // ── 5초마다 자동으로 다음 카드(손대거나 마우스를 올리면 멈춤, 움직임 줄이기 설정이면 안 넘김) ──
  const track = $('heroTrack');
  if (track) {
    const slides = () => [...track.querySelectorAll('.hero-slide')];
    const current = () => { const a = slides()[0], b = slides()[1]; const step = a && b ? b.offsetLeft - a.offsetLeft : 0; return step > 0 ? Math.round(track.scrollLeft / step) : 0; }; // 카드 사이 간격(한 칸 이동 거리)으로 몇 번째인지
    const go2 = (i) => { const s = slides()[i]; if (s) track.scrollTo({ left: s.offsetLeft - slides()[0].offsetLeft, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); };
    let paused = false, resumeAt = 0;
    const pause = () => { paused = true; resumeAt = Date.now() + 8000; };
    const markOn = () => { const c = current(); slides().forEach((s, i) => s.classList.toggle('is-on', i === c)); };
    track.addEventListener('scroll', () => requestAnimationFrame(markOn), { passive: true });
    markOn();
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
  }

  const grid = $('grid');
  if (grid) new MutationObserver(() => refresh()).observe(grid, { childList: true });
})();
