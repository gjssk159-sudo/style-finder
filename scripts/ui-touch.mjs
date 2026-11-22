// 터치 시험(#8): 폰처럼 손가락 입력으로, 열린 창·시트 뒤의 화면이 같이 움직이지 않는지·끌어서 닫히는지 확인한다.
// ui-smoke.mjs 와 같은 가짜 데이터(실제 DB·계정에는 아무것도 안 보냄)로 web/ 을 띄운다.
// 실행: node scripts/ui-touch.mjs   (Chromium 으로 손가락을 흉내 낸 것 — 실제 아이폰 사파리까지 보장하지는 않는다)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const shotDir = process.argv[2];
if (shotDir) mkdirSync(shotDir, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(await readFile(join(root, p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ── 가짜 데이터 ──
const REF = 'fipjvgglzlvksepdjxjv';
const UID = '00000000-0000-4000-8000-000000000001';
const brands = ['온결', '무드랩', '소요', '헤이든', '파인스튜디오'].map((n, i) => ({ id: 100 + i, name: n, type: 'cafe24', status: 'ready', added_by: null }));
const products = Array.from({ length: 12 }, (_, i) => ({
  id: 1000 + i, brand: brands[i % 5].name, brand_id: brands[i % 5].id,
  title: ['울 블렌드 오버핏 싱글 코트', '코튼 와이드 데님 팬츠', '라운드넥 캐시미어 니트', '레더 미니 숄더백', '헤비 코튼 후드 집업', '스트라이프 옥스퍼드 셔츠'][i % 6],
  title_norm: '', categories: ['outer'], colors: ['black'], sizes: [['S', 'M', 'L'], ['250', '260', 'US9', 'US10', 'EU42'], ['28', '30', 'ONE SIZE']][i % 3], min_price: 59000 + i * 1000, max_price: 59000 + i * 1000,
  image: `https://img.test/p${i}.svg`, in_stock: i % 5 !== 3, offer_count: 1, created_at: '2026-11-01T00:00:00Z', first_seen: '2026-11-01',
  offer: [{ source_id: 'a', url: 'https://shop.test/p' + i, price: 59000, in_stock: true }],
}));
const tables = {
  brands, folders: [{ id: 1, name: '내 폴더', share_id: 'abc123', user_id: UID }],
  user_brands: brands.map((b) => ({ folder_id: 1, brand_id: b.id })), product_group: products, qna_posts: [],
};
const user = { id: UID, email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: 'x.' + Buffer.from(JSON.stringify({ sub: UID, exp: 4102444800 })).toString('base64url') + '.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user };

async function open(browser, { login, width = 390, height = 844 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'ko-KR', hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const calls = [];
  await ctx.route(/supabase\.co/, (route) => {
    const r = route.request();
    const u = new URL(r.url());
    calls.push({ method: r.method(), path: u.pathname, query: decodeURIComponent(u.search) });
    if (u.pathname.startsWith('/auth/')) return route.fulfill({ json: user });
    if (u.pathname.startsWith('/functions/')) return route.fulfill({ json: { id: 999, status: 'active' } });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ json: null });
    const rows = tables[u.pathname.replace('/rest/v1/', '')] || [];
    const single = /vnd\.pgrst\.object/.test(r.headers()['accept'] || '');
    const body = r.method() === 'GET' ? (single ? rows[0] || null : rows) : (single ? { id: 999 } : [{ id: 999 }]);
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(body) });
  });
  await ctx.route(/img\.test|shop\.test/, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="4"><rect width="3" height="4" fill="#bbb"/></svg>' }));
  if (login) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000); // 못 찾으면 오래 기다리지 않고 실패로 센다
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss()); // alert/confirm 이 뜨면 닫는다(멈춤 방지)
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  return { ctx, page, calls, errors };
}


// ── 터치 시험(#8): 창·시트가 열린 동안 뒤 화면이 같이 움직이지 않는지, 아래로 끌면 닫히는지, 바깥을 누르면 닫히는지 ──
// 손가락 입력은 브라우저 개발도구 명령(CDP)으로 흉내 낸다. 실제 아이폰 사파리에서의 동작까지 보장하지는 않는다.
const browser = await chromium.launch();
const results = [];
const note = (name, ok, extra = '') => { results.push([ok ? '통과' : '실패', name + (extra ? ' — ' + extra : '')]); };

async function swipe(page, x, y0, y1, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(450);
  await cdp.detach();
}
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
const rectOf = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, h: r.height }; }, sel);
const dlgOpen = (page, sel) => page.evaluate((s) => document.querySelector(s).open, sel);

const s = await open(browser, { login: true });
const p = s.page;
await p.evaluate(() => window.scrollTo(0, 500));
await p.waitForTimeout(500);
const base = await scrollY(p);
note('준비: 홈이 아래로 스크롤돼 있다', base > 200, 'scrollY=' + base);

const CASES = [
  ['이용 안내', '#aboutDialog', () => p.evaluate(() => aboutDialog.showModal())],
  ['브랜드 등록', '#addDialog', () => p.evaluate(() => openAddDialog())],
  ['내 폴더', '#folderDialog', () => p.evaluate(() => { folderDialog.showModal(); renderFolderList(); })],
  ['마이', '#myDialog', () => p.evaluate(() => openMyPage())],
];
for (const [label, sel, open2] of CASES) {
  await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(300);
  const b0 = await scrollY(p); // 화면 길이에 따라 500까지 못 내려갈 수 있어 실제 위치를 기준으로
  await open2(); await p.waitForTimeout(700);
  let r = await rectOf(p, sel);
  await swipe(p, 195, r.top + 18, r.top + 60);
  note(`${label}: 손잡이를 조금 끌어도 뒤 화면이 안 움직인다`, (await scrollY(p)) === b0, 'scrollY=' + (await scrollY(p)));
  r = await rectOf(p, sel);
  if (await dlgOpen(p, sel)) {
    await swipe(p, 195, r.top + r.h * 0.5, r.top + r.h * 0.5 + 90);
    note(`${label}: 본문을 아래로 끌어도 뒤 화면이 안 움직인다`, (await scrollY(p)) === b0, 'scrollY=' + (await scrollY(p)));
    await swipe(p, 195, 60, 160);
    note(`${label}: 바깥을 끌어도 뒤 화면이 안 움직인다`, (await scrollY(p)) === b0, 'scrollY=' + (await scrollY(p)));
  }
  if (await dlgOpen(p, sel)) {
    r = await rectOf(p, sel);
    await swipe(p, 195, r.top + 18, r.top + 260);
  }
  note(`${label}: 손잡이를 아래로 길게 끌면 닫힌다`, !(await dlgOpen(p, sel)));
  await open2(); await p.waitForTimeout(500);
  await p.touchscreen.tap(195, 40); await p.waitForTimeout(500);
  note(`${label}: 바깥을 탭하면 닫힌다`, !(await dlgOpen(p, sel)));
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  await p.waitForTimeout(200);
}

// 필터 시트
await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('filterBtn').click()); await p.waitForTimeout(700);
let fr = await rectOf(p, '.filter-box');
await swipe(p, 195, fr.top + 18, fr.top + 60);
note('필터: 손잡이를 조금 끌어도 뒤 화면이 안 움직인다', (await scrollY(p)) === base, 'scrollY=' + (await scrollY(p)));
await swipe(p, 195, 60, 160);
note('필터: 바깥을 끌어도 뒤 화면이 안 움직인다', (await scrollY(p)) === base, 'scrollY=' + (await scrollY(p)));
fr = await rectOf(p, '.filter-box');
await swipe(p, 195, fr.top + 18, fr.top + 260);
note('필터: 손잡이를 아래로 길게 끌면 닫힌다', !(await p.evaluate(() => document.querySelector('.filter-box').classList.contains('open'))));

// 이용 안내(긴 글): 위로 밀면 시트 안에서 스크롤되고, 끝까지 내려도 뒤 화면은 안 움직인다
await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(500);
await p.evaluate(() => aboutDialog.showModal()); await p.waitForTimeout(900);
const y0 = await scrollY(p);
const ab = await p.evaluate(() => { const b = document.querySelector('#aboutDialog .dlg-body'); const d = document.getElementById('aboutDialog').getBoundingClientRect(); return { top: d.top, h: d.height, st: b.scrollTop, can: b.scrollHeight > b.clientHeight }; });
await swipe(p, 195, ab.top + ab.h * 0.7, ab.top + ab.h * 0.7 - 200);
const st2 = await p.evaluate(() => document.querySelector('#aboutDialog .dlg-body').scrollTop);
note('이용 안내: 위로 밀면 시트 안의 글이 스크롤된다', !ab.can || st2 > ab.st, `scrollTop ${ab.st}→${st2}`);
await swipe(p, 195, ab.top + ab.h * 0.7, ab.top + ab.h * 0.7 - 400);
await swipe(p, 195, ab.top + ab.h * 0.7, ab.top + ab.h * 0.7 - 400);
note('이용 안내: 끝까지 내려도 뒤 화면은 그대로다', (await scrollY(p)) === y0, 'scrollY=' + (await scrollY(p)));
await p.evaluate(() => aboutDialog.close());
await p.waitForTimeout(1500);
await swipe(p, 195, 400, 200);
note('창을 닫으면 뒤 화면이 다시 스크롤된다', (await scrollY(p)) !== y0, 'scrollY=' + (await scrollY(p)));

// 질문 패널 · AI 화면
await p.waitForTimeout(1500);
await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(900);
const b2 = await scrollY(p);
await p.evaluate(() => toggleQa(true)); await p.waitForTimeout(700);
await swipe(p, 195, 300, 420);
note('질문 패널: 아래로 밀어도 뒤 화면이 안 움직인다', (await scrollY(p)) === b2, 'scrollY=' + (await scrollY(p)));
await p.evaluate(() => toggleQa(false)); await p.waitForTimeout(400);
await p.evaluate(() => showAiView()); await p.waitForTimeout(500);
await swipe(p, 195, 300, 420);
note('AI 화면: 아래로 밀어도 뒤 화면이 안 움직인다', (await scrollY(p)) === b2, 'scrollY=' + (await scrollY(p)));
await p.evaluate(() => hideAiView());

// #9: 세부 분류 줄이 상품 카드를 덮지 않는지, 개수 표시가 버튼을 가리지 않는지, 손가락으로 옆으로 밀리는지
{
  const v = await open(browser, { login: true });
  await v.page.locator('#chips .chip', { hasText: /OUTER/ }).first().click();
  await v.page.waitForTimeout(1000);
  const m = await v.page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const sc = document.getElementById('subChips');
    return { subBottom: r(sc).bottom, gridTop: r(document.getElementById('grid')).top, toolTop: r(document.querySelector('.toolrow')).top, n: document.querySelector('#chips .chip.on .chip-n')?.textContent || '', metaShown: getComputedStyle(document.getElementById('meta')).display !== 'none' };
  });
  note('세부 분류 줄이 상품 카드를 덮지 않는다', m.subBottom <= m.gridTop, `줄 아래 ${m.subBottom} · 카드 위 ${m.gridTop}`);
  note('세부 분류 줄이 카테고리 바로 아래(도구 줄 위)에 있다', m.subBottom <= m.toolTop, `세부 아래 ${m.subBottom} · 도구 위 ${m.toolTop}`);
  note('개수는 고른 탭 옆에 작게 보인다(OUTER 12)', m.n === '12', m.n);
  note('고른 조건이 탭뿐이면 아래 개수 줄은 자리를 차지하지 않는다', !m.metaShown, String(m.metaShown));
  const b = await v.page.locator('#subChips .subrow').first().boundingBox();
  const cdp = await v.ctx.newCDPSession(v.page);
  const y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width - 20, y }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width - 20 - i * 20, y }] }); await v.page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await v.page.waitForTimeout(300);
  const sl = await v.page.evaluate(() => document.querySelector('#subChips .subrow').scrollLeft);
  note('세부 분류 줄이 손가락으로 옆으로 밀린다', sl > 50, `scrollLeft=${sl}`);
  await v.ctx.close();
}
// #10: 필터 시트에서 브랜드 검색칸을 누르면(키보드가 올라와 보이는 화면이 줄어도) 검색칸과 목록이 화면 안에 보이는지
{
  const v = await open(browser, { login: true });
  const vp = v.page;
  await vp.evaluate(() => document.getElementById('filterBtn').click()); await vp.waitForTimeout(600);
  const fs = await vp.evaluate(() => getComputedStyle(document.getElementById('brandInput')).fontSize);
  note('브랜드 검색칸 글자가 16px 이상(아이폰 자동 확대 방지)', parseFloat(fs) >= 16, fs);
  await vp.locator('#brandInput').tap(); await vp.waitForTimeout(300);
  await vp.setViewportSize({ width: 390, height: 480 }); await vp.waitForTimeout(500); // 키보드가 올라온 것처럼 보이는 화면을 줄임
  const m = await vp.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const items = [...document.querySelectorAll('#brandComboList .brand-combo-item')];
    const vh = window.visualViewport.height;
    const seen = items.filter((e) => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }).length;
    return { mode: document.querySelector('.filter-box').classList.contains('brand-mode'), boxTop: r('.filter-box').top, boxBottom: r('.filter-box').bottom, inTop: r('#brandInput').top, inBottom: r('#brandInput').bottom, vh, seen, total: items.length };
  });
  note('브랜드 찾기: 시트가 보이는 화면 안에 들어온다', m.mode && m.boxTop >= 0 && m.boxBottom <= m.vh + 1, `시트 ${Math.round(m.boxTop)}~${Math.round(m.boxBottom)} · 화면 ${m.vh}`);
  note('브랜드 찾기: 검색칸이 가려지지 않는다', m.inTop >= 0 && m.inBottom <= m.vh, `검색칸 ${Math.round(m.inTop)}~${Math.round(m.inBottom)}`);
  note('브랜드 찾기: 목록이 화면 안에 다 보인다', m.total === 6 && m.seen === m.total, `${m.seen}/${m.total}개 보임`);
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'brand-mode.png') });
  await vp.locator('#brandComboList .brand-combo-item', { hasText: '소요' }).tap(); await vp.waitForTimeout(500);
  const after = await vp.evaluate(() => ({ v: document.getElementById('brand').value, mode: document.querySelector('.filter-box').classList.contains('brand-mode'), title: document.getElementById('sheetTitle').textContent }));
  note('브랜드를 고르면 선택되고 원래 필터 화면으로 돌아온다', after.v === '소요' && !after.mode && after.title === '필터', JSON.stringify(after));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'brand-picked.png') });
  note('브랜드 찾기 화면 오류 없음', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.ctx.close();
}
// #13: 줄마다 모양이 다르다(카테고리 탭·세부 칩·도구 줄), 누르는 칸 크기, 개수 줄의 조건 ×, 브랜드 네모 글자
{
  const v = await open(browser, { login: true });
  const vp = v.page;
  await vp.locator('#chips .chip', { hasText: /OUTER/ }).first().click(); await vp.waitForTimeout(1000);
  const m = await vp.evaluate(() => {
    const cs = (e) => getComputedStyle(e);
    const on = document.querySelector('#chips .chip.on'), off = document.querySelector('#chips .chip:not(.on)');
    const sub = document.querySelector('#subChips .chip.sub:not(.tag)');
    const tools = [...document.querySelectorAll('.toolrow .tool-filter, .toolrow .tool-chip, .toolrow select, .toolrow label.chk')];
    return {
      tabH: on.getBoundingClientRect().height, tabLine: cs(on).borderBottomWidth, offBg: cs(off).backgroundColor,
      subRadius: parseFloat(cs(sub).borderTopLeftRadius), subH: sub.getBoundingClientRect().height,
      toolMinH: Math.min(...tools.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect().height)), filterBg: cs(document.getElementById('filterBtn')).backgroundColor,
      tags: [...document.querySelectorAll('#meta .mtag')].map((e) => e.textContent),
      initials: [...document.querySelectorAll('.fb i')].map((e) => e.textContent),
      tabFont: parseFloat(cs(on).fontSize),
      toolsShown: [...document.querySelectorAll('.toolrow > *')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.id || e.className),
      stockRight: (() => { const l = document.querySelector('.toolrow label.chk'); return Math.round(innerWidth - l.getBoundingClientRect().right); })(),
      toolFit: (() => { const t = document.querySelector('.toolrow'); return t.scrollWidth - t.clientWidth; })(),
      weights: [...document.querySelectorAll('.toolrow .tool-chip:not(.on), .toolrow select')].map((e) => cs(e).fontWeight).concat(cs(document.querySelector('#meta .meta-n')).fontWeight),
      toolLine: cs(document.querySelector('.toolrow')).borderTopWidth,
      wobble: ['#chips', '#subChips .subrow', '.toolrow'].map((q) => { const e = document.querySelector(q); return e.scrollHeight - e.clientHeight; }),
      gapAbove: document.getElementById('chips').getBoundingClientRect().top - document.getElementById('fCard').getBoundingClientRect().bottom,
      toolGap: (() => { const sc = document.getElementById('subChips'); const prev = sc && sc.getBoundingClientRect().height > 0 ? sc : document.getElementById('chips'); const rg = document.createRange(); rg.selectNodeContents(document.getElementById('filterBtn').firstChild); const t = rg.getBoundingClientRect(); const g = document.getElementById('grid').getBoundingClientRect(); return [Math.round(t.top - prev.getBoundingClientRect().bottom), Math.round(g.top - t.bottom)]; })(),
      tabW: [cs(on).fontWeight, cs(off).fontWeight], fcTabW: cs(document.querySelector('.fc-tab.on') || on).fontWeight, fbW: cs(document.querySelector('.fb i')).fontWeight,
    };
  });
  note('카테고리: 밑줄 탭(높이 40px 이상, 고른 칸에 밑줄, 배경 없음)', m.tabH >= 40 && parseFloat(m.tabLine) >= 2 && m.offBg === 'rgba(0, 0, 0, 0)', JSON.stringify([m.tabH, m.tabLine, m.offBg]));
  note('세부 분류: 네모난 칩(모서리 12px 이하, 높이 36px 이상)', m.subRadius <= 12 && m.subH >= 36, JSON.stringify([m.subRadius, m.subH]));
  note('도구 줄: 누르는 칸 36px 이상, 필터 버튼도 검은 상자 없음', m.toolMinH >= 36 && m.filterBg === 'rgba(0, 0, 0, 0)', JSON.stringify([m.toolMinH, m.filterBg]));
  note('대분류(OUTER)는 탭에 보이므로 조건 표에 겹쳐 나오지 않는다', m.tags.length === 0, JSON.stringify(m.tags));
  note('브랜드 네모에 기호 대신 글자가 들어간다', m.initials.length > 1 && m.initials.every((t) => /^[0-9A-Z가-힣ぁ-んァ-ン一-龥]{1,2}$|^전체$/.test(t)), JSON.stringify(m.initials));
  note('도구 줄엔 필터·정렬·품절 제외만(색상·사이즈는 필터 안)', JSON.stringify(m.toolsShown) === JSON.stringify(['filterBtn', 'sortSlot', 'stockSlot']), JSON.stringify(m.toolsShown));
  note('품절 제외는 오른쪽 끝(오른쪽 여백 16px)', m.stockRight === 16, String(m.stockRight));
  note('도구 줄이 옆으로 밀리지 않고 화면 안에 다 들어온다', m.toolFit <= 0, String(m.toolFit));
  note('도구 줄·개수 글자가 너무 굵지 않다(600 이하)', m.weights.every((w) => +w <= 600), JSON.stringify(m.weights));
  note('카테고리 글자 14px(조금 작게)', m.tabFont === 14, String(m.tabFont));
  note('회색 선은 탭 줄 아래 하나만(도구 줄 위 선 없음)', m.toolLine === '0px', m.toolLine);
  note('옆으로 미는 줄들이 위아래로 흔들리지 않는다(세로 넘침 0)', m.wobble.every((d) => d <= 0), JSON.stringify(m.wobble));
  note('폴더 카드와 카테고리 탭 사이 여백이 작다(8px 이하)', m.gapAbove <= 8, String(m.gapAbove));
  note('도구 줄 글자 위·아래 여백이 같고(차이 2px 이하) 크지 않다(14px 이하)', Math.abs(m.toolGap[0] - m.toolGap[1]) <= 2 && m.toolGap.every((g) => g <= 14), JSON.stringify(m.toolGap));
  note('고른 카테고리·폴더 탭·브랜드 글자가 너무 굵지 않다(600 이하)', +m.tabW[0] <= 600 && +m.fcTabW <= 600 && +m.fbW <= 600, JSON.stringify([m.tabW, m.fcTabW, m.fbW]));
  const bar = await vp.evaluate(() => [...new Set([...document.querySelectorAll('.tabbar button')].map((b) => getComputedStyle(b).color))]);
  note('하단바: 홈·브랜드 등록도 옆 글자와 같은 색', bar.length === 1, JSON.stringify(bar));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'filterbar.png') });
  await vp.evaluate(() => document.getElementById('filterBtn').click()); await vp.waitForTimeout(700);
  const fs1 = await vp.evaluate(() => ['.filter-box .msel', '#sizeChips', '.filter-box .brand-combo'].map((q) => getComputedStyle(document.querySelector(q)).display !== 'none'));
  note('필터 시트 안에 색상·사이즈·브랜드 칸이 다 있다', fs1.every(Boolean), JSON.stringify(fs1));
  const ord = await vp.evaluate(() => ['.filter-box .brand-combo', '.filter-box .price-range', '.filter-box .msel', '#sizeChips'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().top)));
  note('필터 순서: 브랜드 → 가격 → 색상 → 사이즈', ord.every((t, i) => i === 0 || t > ord[i - 1]), JSON.stringify(ord));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'filter-sheet.png') });
  await vp.evaluate(() => document.querySelector('.sheet-x').click()); await vp.waitForTimeout(500);
  await vp.evaluate(() => document.getElementById('sizeChip').click()); await vp.waitForTimeout(700);
  const sz = await vp.evaluate(() => [...document.querySelectorAll('#sizeChips > *')].map((e) => (e.tagName === 'P' ? '#' : '') + e.textContent));
  note('사이즈 시트: 옷·신발·그 밖으로 나뉘고 신발은 US9 → US10 순', JSON.stringify(sz) === JSON.stringify(['#옷 사이즈', 'S', 'M', 'L', 'OS', '#신발 사이즈', '250', '260', 'EU42', 'US9', 'US10', '#그 밖의 사이즈 (바지 허리·모자 등)', '28', '30']), JSON.stringify(sz));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'size-sheet.png') });
  await vp.evaluate(() => document.querySelector('.sheet-x').click()); await vp.waitForTimeout(500);
  await vp.locator('#subChips .chip.sub', { hasText: '카디건' }).first().click(); await vp.waitForTimeout(1000);
  const mid = await vp.evaluate(() => ({ tags: [...document.querySelectorAll('#meta .mtag')].map((e) => e.textContent), shown: getComputedStyle(document.getElementById('meta')).display !== 'none' }));
  note('세부 분류를 고르면 조건 표가 나온다', mid.shown && mid.tags.some((t) => /카디건/.test(t)), JSON.stringify(mid));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'filterbar-tag.png') });
  const tagX = vp.locator('#meta .mtag', { hasText: /카디건/ }).first();
  if (await tagX.count()) { await tagX.tap(); await vp.waitForTimeout(1000); }
  const after = await vp.evaluate(() => ({ cat: document.querySelector('#chips .chip.on')?.firstChild?.textContent, tags: document.querySelectorAll('#meta .mtag').length }));
  note('조건 표의 ×를 누르면 그 조건이 빠진다', after.cat === 'OUTER' && after.tags === 0, JSON.stringify(after));
  note('필터 줄 화면 오류 없음', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.ctx.close();
}
note('화면 오류 없음', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
await s.ctx.close();
await browser.close();
server.close();
for (const [r2, n] of results) console.log(`${r2} ${n}`);
const fails = results.filter((x) => x[0] === '실패').length;
console.log(fails ? `실패 ${fails}건 / ${results.length}` : `모두 통과 ${results.length}건`);
process.exit(fails ? 1 : 0);
