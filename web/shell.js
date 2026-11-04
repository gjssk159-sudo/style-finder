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
    go();
  });

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
