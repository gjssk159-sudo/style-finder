// #16 새 소식(오른쪽 위 알림 종)과 브랜드 랭킹(사람들 폴더에 가장 많이 담긴 브랜드 1~10위).
// 새 소식은 아래 NEWS 맨 위에 한 줄 더하면 된다(id가 바뀌면 종에 초록 점이 다시 뜬다).
const NEWS = [
  { id: '2026-11-23', date: '2026-11-23', title: '위시리스트와 새 홈 화면', body: '상품 사진 오른쪽 아래 하트를 누르면 위시리스트에 담겨요. 마이 → 위시리스트에서 모아 볼 수 있어요. 홈 맨 위에는 브랜드 랭킹과 넘겨 보는 카드가 생겼어요.' },
  { id: '2026-11-22', date: '2026-11-22', title: '필터를 한곳에 모았어요', body: '색상·사이즈도 "필터" 안에서 골라요. 순서는 브랜드 → 가격 → 색상 → 사이즈예요. 품절 제외는 오른쪽 끝에 있어요.' },
  { id: '2026-11-21', date: '2026-11-21', title: '필터 줄이 새로워졌어요', body: '카테고리는 밑줄 탭, 세부 분류는 네모 칩으로 바뀌었어요. 사이즈는 옷·신발·그 밖으로 나눠서 보여 줘요.' },
];

(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const KEY = 'sf_news_seen';
  const seen = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  function markDots() { document.querySelectorAll('.news-dot').forEach((d) => { d.hidden = seen() === NEWS[0].id; }); }
  window.openNews = () => {
    const last = seen();
    $('newsList').innerHTML = NEWS.map((n) => `<article class="news-item${n.id > last ? ' new' : ''}"><time datetime="${n.date}">${n.date.replace(/-/g, '.')}</time><b>${esc(n.title)}</b><p>${esc(n.body)}</p></article>`).join('');
    if (!newsDialog.open) newsDialog.showModal();
    try { localStorage.setItem(KEY, NEWS[0].id); } catch {}
    markDots();
  };
  markDots();

  // ── 브랜드 랭킹 ──
  let top = [];
  let idx = 0;
  let timer = null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const line = (i) => `<span class="rank-i"><em>${i + 1}</em>${esc(top[i].name)}</span>`;
  function tick() {
    if (top.length < 2 || document.hidden) return;
    idx = (idx + 1) % top.length;
    const box = $('rankLine');
    if (reduce.matches) { box.innerHTML = line(idx); return; }
    box.classList.add('out');
    setTimeout(() => { box.innerHTML = line(idx); box.classList.remove('out'); box.classList.add('in'); void box.offsetWidth; box.classList.remove('in'); }, 260); // 아래에서 올라오게: 위치를 한 번 확정한 뒤 바로 풀기
  }
  async function loadRank() {
    const rows = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from('user_brands').select('user_id,brand_id').range(from, from + 999);
      if (error || !data) return;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const by = new Map();
    for (const r of rows) { if (!by.has(r.brand_id)) by.set(r.brand_id, new Set()); by.get(r.brand_id).add(r.user_id); }
    const ranked = [...by].map(([id, users]) => ({ id, n: users.size }));
    if (!ranked.length) return;
    const { data: bs } = await sb.from('brands').select('id,name').in('id', ranked.map((x) => x.id));
    const names = new Map((bs || []).map((b) => [b.id, b.name]));
    top = ranked.map((x) => ({ ...x, name: names.get(x.id) || String(x.id) }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ko'))
      .slice(0, 10);
    idx = 0;
    $('rankLine').innerHTML = line(0);
    $('rankList').innerHTML = top.map((x, i) => `<li><em>${i + 1}</em><span>${esc(x.name)}</span></li>`).join('');
    $('rank').hidden = false;
    clearInterval(timer);
    timer = setInterval(tick, 3000);
  }
  $('rank').addEventListener('click', () => rankDialog.showModal());
  loadRank();
})();
