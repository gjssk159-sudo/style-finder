// 모바일 앱 껍데기: 하단 탭바, 필터 바텀시트, AI 서비스 화면.
// app.js의 기존 기능(로그인/마이페이지/브랜드 등록/내 폴더)을 그대로 불러다 쓰고, 화면 배치만 바꾼다.
(function () {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const mq = window.matchMedia('(max-width: 700px)');

  // ── 정렬 선택: 모바일에선 검색창 아래 줄(필터 버튼 옆)로, PC에선 원래 필터 줄로 ──
  const sortEl = $('sort');
  const sortHome = document.createComment('sort-home');
  sortEl.parentNode.insertBefore(sortHome, sortEl);
  function placeSort() {
    if (mq.matches) $('sortSlot').appendChild(sortEl);
    else sortHome.parentNode.insertBefore(sortEl, sortHome.nextSibling);
  }
  placeSort();
  (mq.addEventListener ? mq.addEventListener('change', placeSort) : mq.addListener(placeSort));

  // ── 필터 바텀시트 ──
  const box = document.querySelector('.filter-box');
  const dim = $('sheetDim');
  box.insertAdjacentHTML('afterbegin',
    '<div class="sheet-head"><b>FILTER</b><button type="button" class="sheet-reset">초기화</button><button type="button" class="sheet-x" aria-label="닫기">' +
    '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>');
  box.insertAdjacentHTML('beforeend', '<button type="button" class="sheet-cta">결과 보기</button>');
  function openFilter() { box.classList.add('open'); dim.hidden = false; root.classList.add('sheet-open'); }
  function closeFilter() { box.classList.remove('open'); dim.hidden = true; root.classList.remove('sheet-open'); countFilters(); }
  $('filterBtn').addEventListener('click', openFilter);
  dim.addEventListener('click', closeFilter);
  box.querySelector('.sheet-x').addEventListener('click', closeFilter);
  box.querySelector('.sheet-cta').addEventListener('click', closeFilter);
  box.querySelector('.sheet-reset').addEventListener('click', () => {
    colorSel = [];
    pendingSize = '';
    $('size').value = '';
    $('brand').value = '';
    $('brandInput').value = '';
    $('priceMin').value = '';
    $('priceMax').value = '';
    $('inStock').checked = false;
    currentPage = 1;
    closeColorPanel();
    renderColorPanel();
    countFilters();
    syncSizeChips();
    buildFolderCard();
    go();
  });

  // 사이즈: 선택 상자 대신 칩으로(원래 선택 상자는 그대로 두고 값만 맞춘다)
  const sizeEl = $('size');
  sizeEl.insertAdjacentHTML('afterend', '<div id="sizeChips"></div>');
  const sizeChips = $('sizeChips');
  function buildSizeChips() {
    sizeChips.innerHTML = [...sizeEl.options].filter((o) => o.value).map((o) =>
      '<button type="button" data-v="' + o.value.replace(/"/g, '&quot;') + '">' + o.textContent + '</button>').join('');
    syncSizeChips();
  }
  function syncSizeChips() {
    const cur = sizeEl.value || (typeof pendingSize !== 'undefined' ? pendingSize : '');
    sizeChips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === cur));
  }
  sizeChips.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const same = b.classList.contains('on');
    sizeEl.value = same ? '' : b.dataset.v;
    sizeEl.dispatchEvent(new Event('change', { bubbles: true }));
    syncSizeChips();
  });
  new MutationObserver(buildSizeChips).observe(sizeEl, { childList: true });
  buildSizeChips();

  // 필터 시트 맨 아래 버튼에 지금 결과 개수를 보여준다
  const cta = box.querySelector('.sheet-cta');
  function syncCta() {
    const m = ($('meta').textContent || '').match(/([\d,]+)\s*개/);
    cta.textContent = m ? '상품 ' + m[1] + '개 보기' : '결과 보기';
  }
  new MutationObserver(syncCta).observe($('meta'), { childList: true, characterData: true, subtree: true });
  syncCta();

  // 검색창 아래 색상/사이즈 칩은 필터 시트의 해당 칸으로 바로 열어 준다
  document.querySelectorAll('.tool-chip').forEach((b) => b.addEventListener('click', () => {
    openFilter();
    const target = b.dataset.open === 'color' ? box.querySelector('.msel') : sizeChips;
    setTimeout(() => target.scrollIntoView({ block: 'start' }), 60);
  }));

  // 내 폴더 카드: 폴더에 담긴 브랜드를 한 줄로 보여주고, 누르면 그 브랜드만 본다
  const fCard = $('fCard'), fcRow = $('fcRow'), brandSel = $('brand');
  function buildFolderCard() {
    const brands = [...brandSel.options].filter((o) => o.value).map((o) => o.value);
    fCard.hidden = brands.length === 0;
    const cur = brandSel.value;
    const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    fcRow.innerHTML = '<button type="button" class="fb' + (cur ? '' : ' on') + '" data-b=""><i>전체</i><span>' + brands.length + '</span></button>' +
      brands.map((n) => '<button type="button" class="fb' + (n === cur ? ' on' : '') + '" data-b="' + esc(n) + '"><i>' + esc(n.trim().charAt(0).toUpperCase()) + '</i><span>' + esc(n) + '</span></button>').join('');
  }
  fcRow.addEventListener('click', (e) => {
    const b = e.target.closest('.fb'); if (!b) return;
    pickBrand(b.dataset.b);
    setTimeout(buildFolderCard, 0);
  });
  $('fcManage').addEventListener('click', () => { folderDialog.showModal(); renderFolderList(); });
  new MutationObserver(buildFolderCard).observe(brandSel, { childList: true });
  box.addEventListener('change', () => setTimeout(() => { buildFolderCard(); syncSizeChips(); }, 0));
  box.addEventListener('click', () => setTimeout(() => { buildFolderCard(); syncSizeChips(); }, 80));
  buildFolderCard();

  // 지금 걸려 있는 필터 개수를 필터 버튼에 표시
  function countFilters() {
    let n = 0;
    try { n += colorSel.length; } catch {}
    if ($('size').value) n++;
    if ($('brand').value) n++;
    if ($('priceMin').value || $('priceMax').value) n++;
    if ($('inStock').checked) n++;
    const c = $('filterCnt');
    c.textContent = n || '';
    c.hidden = !n;
  }
  box.addEventListener('input', () => setTimeout(countFilters, 0));
  box.addEventListener('change', () => setTimeout(countFilters, 0));
  box.addEventListener('click', () => setTimeout(countFilters, 50));
  setTimeout(countFilters, 1500);
  setTimeout(countFilters, 4000);

  // ── 탭 이동 ──
  const tabs = document.querySelectorAll('.tabbar button');
  function setTab(name) { tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === name)); }
  function showAi() {
    $('aiView').hidden = false;
    root.classList.add('ai-open');
    setTab('ai');
    $('aiView').scrollTop = 0;
  }
  function hideAi() {
    $('aiView').hidden = true;
    root.classList.remove('ai-open');
    setTab('home');
  }
  window.showAiView = showAi;
  window.hideAiView = hideAi;
  const go2 = {
    home() { closeFilter(); hideAi(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    ai() { closeFilter(); showAi(); },
    add() { closeFilter(); openAddDialog(); },
    folder() { closeFilter(); folderDialog.showModal(); renderFolderList(); },
    my() { closeFilter(); if (currentUser) openMyPage(); else openAuthDialog(); },
  };
  tabs.forEach((b) => b.addEventListener('click', () => go2[b.dataset.tab]()));
  document.querySelectorAll('.nav-ai').forEach((b) => b.addEventListener('click', showAi));
  $('aiBack').addEventListener('click', hideAi);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (box.classList.contains('open')) closeFilter();
    else if (!$('aiView').hidden) hideAi();
  });
})();
