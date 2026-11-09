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
  const stockEl = $('inStock').closest('label');
  const stockHome = document.createComment('stock-home');
  stockEl.parentNode.insertBefore(stockHome, stockEl);
  function placeSort() {
    if (mq.matches) { $('sortSlot').appendChild(sortEl); $('stockSlot').appendChild(stockEl); }
    else { sortHome.parentNode.insertBefore(sortEl, sortHome.nextSibling); stockHome.parentNode.insertBefore(stockEl, stockHome.nextSibling); }
  }
  placeSort();
  (mq.addEventListener ? mq.addEventListener('change', placeSort) : mq.addListener(placeSort));

  // ── 필터 바텀시트 ──
  const box = document.querySelector('.filter-box');
  const dim = $('sheetDim');
  box.insertAdjacentHTML('afterbegin',
    '<div class="sheet-head"><b id="sheetTitle">필터</b><button type="button" class="sheet-reset">초기화</button><button type="button" class="sheet-x" aria-label="닫기">' +
    '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>');
  box.insertAdjacentHTML('beforeend', '<button type="button" class="sheet-cta">결과 보기</button>');
  const TITLES = { filter: '필터', color: '색상', size: '사이즈' };
  function openFilter(mode) {
    mode = TITLES[mode] ? mode : 'filter';
    box.dataset.mode = mode;
    $('sheetTitle').textContent = TITLES[mode];
    box.scrollTop = 0;
    box.classList.add('open'); dim.hidden = false; root.classList.add('sheet-open');
  }
  function closeFilter() { box.classList.remove('open'); dim.hidden = true; root.classList.remove('sheet-open'); countFilters(); }
  $('filterBtn').addEventListener('click', () => openFilter('filter'));
  document.querySelectorAll('.tool-chip').forEach((b) => b.addEventListener('click', () => openFilter(b.dataset.open)));
  dim.addEventListener('click', closeFilter);
  box.querySelector('.sheet-x').addEventListener('click', closeFilter);
  box.querySelector('.sheet-cta').addEventListener('click', closeFilter);
  box.querySelector('.sheet-reset').addEventListener('click', () => {
    const mode = box.dataset.mode;
    if (mode === 'color') colorSel = [];
    else if (mode === 'size') { pendingSize = ''; $('size').value = ''; }
    else { $('brand').value = ''; $('brandInput').value = ''; $('priceMin').value = ''; $('priceMax').value = ''; }
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

  // 내 폴더 카드: 폴더에 담긴 브랜드를 한 줄로 보여주고, 누르면 그 브랜드만 본다
  const fCard = $('fCard'), fcRow = $('fcRow'), brandSel = $('brand');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function buildFolderCard() {
    const brands = [...brandSel.options].filter((o) => o.value).map((o) => o.value);
    const folders = typeof myFolders !== 'undefined' ? myFolders : [];
    fCard.hidden = typeof currentUser === 'undefined' || !currentUser || (folders.length === 0 && brands.length === 0);
    const cur = brandSel.value;
    // 폴더가 여러 개면 위쪽 탭으로 바로 바꿀 수 있게(비어 있는 폴더에서도 다른 폴더로 돌아올 수 있어야 한다)
    $('fcTabs').innerHTML = folders.length > 1
      ? folders.map((f) => '<button type="button" class="fc-tab' + (f.id === currentFolderId ? ' on' : '') + '" data-f="' + f.id + '">' + esc(f.name) + '</button>').join('')
      : '<button type="button" class="fc-tab on">' + esc((folders[0] && folders[0].name) || '내 폴더') + '</button>';
    if (brands.length === 0) {
      fcRow.innerHTML = '<div class="fc-empty"><span>이 폴더는 비어 있어요.</span><button type="button" data-manage="1">브랜드 담기</button></div>';
      return;
    }
    fcRow.innerHTML = '<button type="button" class="fb' + (cur ? '' : ' on') + '" data-b=""><i>전체</i><span>' + brands.length + '</span></button>' +
      brands.map((n) => '<button type="button" class="fb' + (n === cur ? ' on' : '') + '" data-b="' + esc(n) + '"><i>' + esc(n.trim().charAt(0).toUpperCase()) + '</i><span>' + esc(n) + '</span></button>').join('');
  }
  $('fcTabs').addEventListener('click', async (e) => {
    const t = e.target.closest('.fc-tab'); if (!t || !t.dataset.f) return;
    await switchFolder(Number(t.dataset.f));
    buildFolderCard();
  });
  fcRow.addEventListener('click', (e) => {
    if (e.target.closest('[data-manage]')) { folderDialog.showModal(); renderFolderList(); return; }
    const b = e.target.closest('.fb'); if (!b) return;
    pickBrand(b.dataset.b);
    setTimeout(buildFolderCard, 0);
  });
  $('fcManage').addEventListener('click', () => { folderDialog.showModal(); renderFolderList(); });
  new MutationObserver(buildFolderCard).observe(brandSel, { childList: true });
  box.addEventListener('change', () => setTimeout(() => { buildFolderCard(); syncSizeChips(); }, 0));
  box.addEventListener('click', () => setTimeout(() => { buildFolderCard(); syncSizeChips(); }, 80));
  folderDialog.addEventListener('close', () => setTimeout(buildFolderCard, 100));
  buildFolderCard();
  setTimeout(buildFolderCard, 1500);
  setTimeout(buildFolderCard, 4000);

  // 지금 걸려 있는 필터 개수를 필터 버튼에 표시
  function countFilters() {
    let n = 0;
    if ($('brand').value) n++;
    if ($('priceMin').value || $('priceMax').value) n++;
    const c = $('filterCnt');
    c.textContent = n || '';
    c.hidden = !n;
    $('filterBtn').classList.toggle('on', n > 0);
    let cn = 0;
    try { cn = colorSel.length; } catch {}
    $('colorChip').textContent = cn ? '색상 ' + cn : '색상';
    $('colorChip').classList.toggle('on', cn > 0);
    const sz = $('size').value || (typeof pendingSize !== 'undefined' ? pendingSize : '');
    $('sizeChip').textContent = sz || '사이즈';
    $('sizeChip').classList.toggle('on', !!sz);
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
  // 로고를 누르면 검색·필터·카테고리를 모두 처음 상태로(앱 쪽 초기화 + 새 화면 요소들도 같이 맞춘다)
  const baseReset = window.resetAll;
  window.resetAll = function () {
    closeFilter();
    hideAi();
    const r = baseReset.apply(this, arguments);
    syncSizeChips();
    countFilters();
    setTimeout(() => { buildFolderCard(); countFilters(); }, 50);
    window.scrollTo({ top: 0 });
    return r;
  };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (box.classList.contains('open')) closeFilter();
    else if (!$('aiView').hidden) hideAi();
  });

  // ── 시트·창이 열려 있는 동안: 뒤 화면은 움직이지 않게, 아래로 끌면 닫히게, 바깥을 누르면 닫히게 ──
  // 가장 위에 열려 있는 창(대화상자 > 필터 시트 > 질문 패널 > AI 화면)
  function activeSheet() {
    const ds = document.querySelectorAll('dialog[open]');
    if (ds.length) return ds[ds.length - 1];
    if (box.classList.contains('open')) return box;
    const qa = document.getElementById('qaPanel');
    if (qa && qa.classList.contains('open')) return qa;
    if (!$('aiView').hidden) return $('aiView');
    return null;
  }
  function syncLock() { root.classList.toggle('scroll-lock', !!activeSheet()); }
  new MutationObserver(syncLock).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'class', 'hidden'] });
  syncLock();

  // 손가락이 움직이는 방향으로 실제로 스크롤될 칸이 창 안에 있는지
  function canScrollWithin(target, sheet, dy) {
    for (let el = target; el && el.nodeType === 1 && el !== document.documentElement; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        if (dy > 0 && el.scrollTop > 0) return true;
        if (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      }
      if (el === sheet) break;
    }
    return false;
  }
  const HANDLE_ZONE = 56; // 시트 윗부분(손잡이·제목) 높이: 여기서 끌면 어디서든 시트가 내려간다
  const CLOSE_DIST = 110; // 이만큼 끌면 닫힌다
  let drag = null;
  function dismiss(sheet) {
    if (sheet === box) closeFilter();
    else if (sheet.tagName === 'DIALOG') { sheet.close(); if (sheet.id === 'folderDialog' && typeof go === 'function') go(); }
  }
  document.addEventListener('touchstart', (e) => {
    drag = null;
    if (e.touches.length !== 1) return;
    const sheet = activeSheet();
    if (!sheet || !mq.matches || !(sheet === box || sheet.tagName === 'DIALOG')) { if (sheet) drag = { sheet, startY: e.touches[0].clientY, startX: e.touches[0].clientX, can: false, on: false }; return; }
    const t = e.touches[0], rect = sheet.getBoundingClientRect();
    const inside = t.clientY >= rect.top && t.clientY <= rect.bottom && t.clientX >= rect.left && t.clientX <= rect.right;
    const inHandle = inside && t.clientY - rect.top <= HANDLE_ZONE;
    // 본문이 맨 위에 붙어 있을 때 아래로 끌어도 시트가 내려간다(본문이 더 올라갈 데가 없을 때만)
    const atTop = inside && !canScrollWithin(e.target, sheet, 1);
    drag = { sheet, startY: t.clientY, startX: t.clientX, lastY: t.clientY, lastT: Date.now(), v: 0, can: inHandle || atTop, on: false };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const sheet = activeSheet();
    if (!sheet) return;
    const t = e.touches[0];
    if (drag && drag.on) {
      e.preventDefault();
      const dy = Math.max(0, t.clientY - drag.startY), now = Date.now();
      drag.v = (t.clientY - drag.lastY) / Math.max(1, now - drag.lastT); drag.lastY = t.clientY; drag.lastT = now;
      drag.sheet.style.transform = 'translateY(' + dy + 'px)';
      return;
    }
    const dy = t.clientY - (drag ? drag.startY : t.clientY), dx = t.clientX - (drag ? drag.startX : t.clientX);
    if (drag && drag.can && dy > 6 && Math.abs(dy) > Math.abs(dx)) {
      drag.on = true; drag.sheet.style.transition = 'none';
      e.preventDefault();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) return; // 가로로 미는 건 그대로 둔다
    // 창 바깥이거나, 창 안에서도 더 스크롤될 데가 없으면 뒤 화면이 따라 움직이지 않게 막는다
    const rect = sheet.getBoundingClientRect();
    const outside = t.clientY < rect.top || t.clientY > rect.bottom || t.clientX < rect.left || t.clientX > rect.right;
    if (outside || !canScrollWithin(e.target, sheet, dy)) { if (e.cancelable) e.preventDefault(); }
  }, { passive: false });
  function endDrag() {
    if (!drag || !drag.on) { drag = null; return; }
    const d = drag; drag = null;
    const dist = d.lastY - d.startY;
    d.sheet.style.transition = 'transform .22s ease';
    if (dist > CLOSE_DIST || (d.v > 0.6 && dist > 40)) {
      d.sheet.style.transform = 'translateY(100%)';
      setTimeout(() => { dismiss(d.sheet); d.sheet.style.transform = ''; d.sheet.style.transition = ''; }, 200);
    } else {
      d.sheet.style.transform = '';
      setTimeout(() => { d.sheet.style.transition = ''; }, 240);
    }
  }
  document.addEventListener('touchend', endDrag, { passive: true });
  document.addEventListener('touchcancel', endDrag, { passive: true });

  // 어두운 바깥을 누르면 닫힌다(안에서 누르고 바깥에서 뗀 경우는 제외)
  ['addDialog', 'folderDialog', 'aboutDialog', 'authDialog', 'myDialog'].forEach((id) => {
    const dlg = $(id); if (!dlg) return;
    let downOutside = false;
    const outsideOf = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    dlg.addEventListener('pointerdown', (e) => { downOutside = e.target === dlg && outsideOf(e); });
    dlg.addEventListener('click', (e) => {
      if (downOutside && e.target === dlg && outsideOf(e)) { dismiss(dlg); }
      downOutside = false;
    });
  });
})();
