// 브랜드 화면 머리 (T-04 3단계, 틀 A D-5 · 룩북형 D-6 · 초록 D-7)
// 브랜드 하나를 골랐을 때(#brand 값이 있을 때) 목록 위에 "큰 사진 + 큰 브랜드 이름 + 상품 수 + 담기/빼기 + 뒤로"를 보여 준다.
// 새 기능 없음: 담기/빼기는 기존 toggleFolder(), 뒤로는 기존 pickBrand(''), 빼기 확인은 기존 askConfirm().
// app.js 전역(allBrands, myFolderIds, lastTotal, currentUser, sharedView, thumbUrl, toggleFolder, pickBrand, askConfirm)을 쓴다.
(function () {
  const head = document.getElementById('brandHead');
  const sel = document.getElementById('brand');
  if (!head || !sel) return;
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let busy = false;

  function photoFor(name) {
    const th = (window.brandThumbs || {})[name];
    if (th) return th;
    const img = document.querySelector('#grid .card img');
    return img ? img.currentSrc || img.src : '';
  }

  function render() {
    const name = sel.value;
    const on = !!name && typeof currentUser !== 'undefined' && !!currentUser && !(typeof sharedView !== 'undefined' && sharedView);
    head.hidden = !on;
    document.documentElement.classList.toggle('bh-on', on);
    if (!on) return;
    const b = (typeof allBrands !== 'undefined' ? allBrands : []).find((x) => x.name === name);
    const inFolder = !!b && myFolderIds.includes(b.id);
    const no = b ? String((myFolderIds.indexOf(b.id) + 1) || '').padStart(2, '0') : '';
    const photo = photoFor(name);
    head.innerHTML = `
      <div class="bh-hero"${photo ? ` style="background-image:url(&quot;${esc(photo)}&quot;)"` : ''}>
        <button type="button" class="bh-back" data-act="back">‹ 뒤로</button>
        <div class="bh-corner">${no ? 'BRAND ' + no + '<br>' : ''}${Number(lastTotal || 0).toLocaleString('ko-KR')} ITEMS</div>
        <h2 class="bh-name">${esc(name)}</h2>
      </div>
      <div class="bh-bar">
        <div class="bh-count">상품 ${Number(lastTotal || 0).toLocaleString('ko-KR')}개</div>
        ${b ? `<button type="button" class="bh-btn ${inFolder ? 'on' : ''}" data-act="${inFolder ? 'remove' : 'add'}" ${busy ? 'disabled' : ''}>${inFolder ? '담은 브랜드 ✓' : '담기 ＋'}</button>` : ''}
      </div>`;
  }

  head.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || busy) return;
    const act = t.dataset.act;
    if (act === 'back') { pickBrand(''); window.scrollTo({ top: 0 }); return; }
    const b = allBrands.find((x) => x.name === sel.value);
    if (!b) return;
    if (act === 'remove' && !(await askConfirm(`"${b.name}"을(를) 지금 폴더에서 뺄까요?`))) return;
    busy = true; render();
    try {
      await toggleFolder(b.id, act === 'add');
    } finally { busy = false; }
    if (act === 'remove') { pickBrand(''); window.scrollTo({ top: 0 }); } // 폴더에서 빠지면 이 브랜드 화면은 더 볼 수 없다
    else render();
  });

  new MutationObserver(render).observe(sel, { childList: true, attributes: true });
  const meta = document.getElementById('meta');
  if (meta) new MutationObserver(render).observe(meta, { childList: true, characterData: true, subtree: true });
  window.addEventListener('popstate', render);
  render();
})();
