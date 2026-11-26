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
// #20 추천 후보(내 폴더에 없음): 아우터·6만 원대(SAFARISPOT, XLIM)는 내 취향과 비슷, 가방·30만 원대(BAGSHOP)는 거리가 멂
const extraBrands = [['SAFARISPOT', 105], ['BAGSHOP', 106], ['XLIM', 107]].map(([n, id]) => ({ id, name: n, type: 'cafe24', status: 'ready', added_by: null, shop_url: 'https://shop.test/' + n }));
const brandProfile = [100, 101, 102, 103, 104].flatMap((id) => [{ brand_id: id, cat: 'coat', n: 8, med_price: 60000 }, { brand_id: id, cat: 'knit', n: 4, med_price: 55000 }])
  .concat([{ brand_id: 105, cat: 'coat', n: 10, med_price: 65000 }, { brand_id: 105, cat: 'knit', n: 3, med_price: 60000 }, { brand_id: 106, cat: 'backpack', n: 20, med_price: 300000 }, { brand_id: 107, cat: 'coat', n: 6, med_price: 70000 }, { brand_id: 107, cat: 'tshirt', n: 6, med_price: 40000 }]);
const products = Array.from({ length: 12 }, (_, i) => ({
  id: 1000 + i, brand: brands[i % 5].name, brand_id: brands[i % 5].id,
  title: ['울 블렌드 오버핏 싱글 코트', '코튼 와이드 데님 팬츠', '라운드넥 캐시미어 니트', '레더 미니 숄더백', '헤비 코튼 후드 집업', '스트라이프 옥스퍼드 셔츠'][i % 6],
  title_norm: '', categories: ['outer'], colors: ['black'], sizes: [['S', 'M', 'L'], ['250', '260', 'US9', 'US10', 'EU42'], ['28', '30', 'ONE SIZE']][i % 3], min_price: 59000 + i * 1000, max_price: 59000 + i * 1000,
  image: `https://img.test/p${i}.svg`, in_stock: i % 5 !== 3, offer_count: 1, created_at: '2026-11-01T00:00:00Z', first_seen: '2026-11-01',
  offer: [{ source_id: 'a', url: 'https://shop.test/p' + i, price: 59000, in_stock: true }],
}));
const tables = {
  brands: brands.concat(extraBrands), brand_profile: brandProfile, folders: [{ id: 1, name: '내 폴더', share_id: 'abc123', user_id: UID }],
  user_brands: brands.map((b) => ({ folder_id: 1, brand_id: b.id, user_id: UID })).concat([[9, 101, 'u2'], [9, 102, 'u2'], [8, 101, 'u3']].map(([f, b, u]) => ({ folder_id: f, brand_id: b, user_id: u }))), product_group: products, qna_posts: [],
  // #15 장바구니: 담긴 상품 1개 + 쇼핑몰에서 사라진 상품 1개(product_group 없음)
  cart_items: [
    { id: 1, group_id: 1001, brand: '무드랩', title: '코튼 와이드 데님 팬츠', image: 'https://img.test/p1.svg', price: 60000, url: 'https://shop.test/p1', added_at: '2026-11-22T00:00:00Z', product_group: { in_stock: true, min_price: 60000, image: 'https://img.test/p1.svg', offer: [{ url: 'https://shop.test/p1' }] } },
    { id: 2, group_id: null, brand: '소요', title: '린넨 셔츠 자켓', image: null, price: 89000, url: 'https://shop.test/old', added_at: '2026-11-20T00:00:00Z', product_group: null },
  ],
};
const user = { id: UID, email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
const session = { access_token: 'x.' + Buffer.from(JSON.stringify({ sub: UID, exp: 4102444800 })).toString('base64url') + '.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user };

async function open(browser, { login, width = 390, height = 844, demoRank = false }) {
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
  if (!demoRank) await ctx.addInitScript(() => localStorage.setItem('sf_rank_real', '1')); // 랭킹은 실제 주간 계산으로(임시 순서 모드는 따로 시험)
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
  ['비밀번호 변경', '#pwDialog', () => p.evaluate(() => openPwSheet())], // #17 마이는 전체 화면이 됐고, 끌어서 닫는 창은 비밀번호 변경
];
for (const [label, sel, open2] of CASES) {
  await p.evaluate(() => window.scrollTo(0, 500)); await p.waitForTimeout(300);
  const b0 = await scrollY(p); // 화면 길이에 따라 500까지 못 내려갈 수 있어 실제 위치를 기준으로
  await open2(); await p.waitForTimeout(700);
  let r = await rectOf(p, sel);
  await swipe(p, 195, r.top + 18, r.top + 60);
  note(`${label}: 손잡이를 조금 끌어도 뒤 화면이 안 움직인다`, Math.abs((await scrollY(p)) - b0) <= 2, 'scrollY=' + (await scrollY(p)) + ' (기준 ' + b0 + ', 2px 이하 차이는 반올림이라 허용)');
  r = await rectOf(p, sel);
  if (await dlgOpen(p, sel)) {
    await swipe(p, 195, r.top + r.h * 0.5, r.top + r.h * 0.5 + 90);
    note(`${label}: 본문을 아래로 끌어도 뒤 화면이 안 움직인다`, Math.abs((await scrollY(p)) - b0) <= 2, 'scrollY=' + (await scrollY(p)) + ' (기준 ' + b0 + ', 2px 이하 차이는 반올림이라 허용)');
    await swipe(p, 195, 60, 160);
    note(`${label}: 바깥을 끌어도 뒤 화면이 안 움직인다`, Math.abs((await scrollY(p)) - b0) <= 2, 'scrollY=' + (await scrollY(p)) + ' (기준 ' + b0 + ', 2px 이하 차이는 반올림이라 허용)');
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
      gapAbove: document.getElementById('chips').getBoundingClientRect().top - document.getElementById('hero').getBoundingClientRect().bottom,
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
  note('카테고리 줄 위·아래에 같은 실선', await vp.evaluate(() => { const b = getComputedStyle(document.getElementById('chips')).backgroundImage; const p = getComputedStyle(document.getElementById('chips')).backgroundPosition; return (b.match(/linear-gradient/g) || []).length === 2 && /0%/.test(p.split(',')[0]) && /100%/.test(p.split(',')[1]); }));
  note('카테고리 글자 14px(조금 작게)', m.tabFont === 14, String(m.tabFont));
  note('회색 선은 탭 줄 아래 하나만(도구 줄 위 선 없음)', m.toolLine === '0px', m.toolLine);
  note('옆으로 미는 줄들이 위아래로 흔들리지 않는다(세로 넘침 0)', m.wobble.every((d) => d <= 0), JSON.stringify(m.wobble));
  note('넘겨 보는 카드와 카테고리 탭 사이 여백 20px(카드 위 여백과 같게)', m.gapAbove === 20, String(m.gapAbove));
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
// #15 장바구니: 카드의 버튼으로 담고/빼고, 하단바 장바구니 칸에서 목록을 본다
{
  const v = await open(browser, { login: true });
  const vp = v.page;
  const c0 = await vp.evaluate(() => {
    const b = document.querySelectorAll('#grid .cart-btn');
    const card = document.querySelector('#grid .cw');
    const img = card.querySelector('.imgwrap').getBoundingClientRect(), r = b[0].getBoundingClientRect();
    const tab = document.getElementById('myWish');
    return { n: b.length, inA: !!document.querySelector('a.card .cart-btn'), onIds: [...b].filter((x) => x.classList.contains('on')).map((x) => x.dataset.gid),
      inImg: r.right <= img.right && r.bottom <= img.bottom && r.top >= img.top && img.right - r.right <= 12 && img.bottom - r.bottom <= 12,
      size: [r.width, r.height], tab: tab && tab.textContent.trim(), cnt: tab && tab.querySelector('.cart-num').textContent, folderTab: !!document.querySelector('.tabbar [data-tab=folder]'), cartTab: !!document.querySelector('.tabbar [data-tab=cart]') };
  });
  note('장바구니: 카드마다 버튼이 있고 링크 안에 겹치지 않는다', c0.n >= 12 && !c0.inA, JSON.stringify([c0.n, c0.inA]));
  note('장바구니: 버튼이 사진 오른쪽 아래 안쪽에 있다(36px)', c0.inImg && c0.size[0] === 36, JSON.stringify([c0.inImg, c0.size]));
  note('장바구니: 이미 담은 상품은 버튼이 켜져 있다', JSON.stringify(c0.onIds) === '["1001"]', JSON.stringify(c0.onIds));
  note('하단바엔 내 폴더(장바구니 칸 없음), 마이 안 위시리스트 칸에 담은 개수 2', c0.folderTab && !c0.cartTab && /위시리스트/.test(c0.tab) && c0.cnt === '2', JSON.stringify(c0));
  let n = v.calls.length;
  await vp.locator('#grid .cart-btn[data-gid="1000"]').tap(); await vp.waitForTimeout(600);
  const add = await vp.evaluate(() => ({ on: document.querySelector('#grid .cart-btn[data-gid="1000"]').classList.contains('on'), toast: document.getElementById('cartToast').textContent, url: location.href }));
  const post = v.calls.slice(n).find((c) => c.path.endsWith('/cart_items') && c.method === 'POST');
  note('위시리스트: 하트를 누르면 담기 요청을 보내고 켜지며 "담았어요"가 뜬다(쇼핑몰로 안 넘어감)', !!post && add.on && /담았어요/.test(add.toast) && !/shop\.test/.test(add.url), JSON.stringify([!!post, add]));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'cart-home.png') });
  await vp.evaluate(() => document.querySelector('.tabbar [data-tab=my]').click()); await vp.waitForTimeout(500);
  await vp.evaluate(() => document.getElementById('myWish').click()); await vp.waitForTimeout(800);
  const cv = await vp.evaluate(() => ({ shown: !document.getElementById('cartView').hidden, items: [...document.querySelectorAll('#cartList .ci')].map((e) => e.querySelector('.ci-t').textContent + (e.classList.contains('gone') ? '(끝남)' : '')), links: [...document.querySelectorAll('#cartList a.ci-link')].map((a) => a.getAttribute('href')), on: document.getElementById('myView').hidden }));
  note('위시리스트 화면(마이 → 위시리스트): 담은 상품이 보이고 사라진 상품은 "판매 끝남"(링크 없음)', cv.shown && cv.on && cv.items.includes('린넨 셔츠 자켓(끝남)') && cv.items.includes('코튼 와이드 데님 팬츠') && !cv.links.includes('https://shop.test/old'), JSON.stringify(cv));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'cart-view.png') });
  n = v.calls.length;
  await vp.locator('#cartList .ci-x').first().tap(); await vp.waitForTimeout(600);
  const del = v.calls.slice(n).find((c) => c.path.endsWith('/cart_items') && c.method === 'DELETE');
  note('장바구니 화면: ×를 누르면 빼기 요청을 보낸다', !!del, del ? del.query : '');
  await vp.evaluate(() => document.querySelector('.tabbar [data-tab=home]').click()); await vp.waitForTimeout(500);
  note('장바구니: 홈 칸을 누르면 장바구니 화면이 닫힌다', await vp.evaluate(() => document.getElementById('cartView').hidden));
  await vp.evaluate(() => window.openCartTab()); await vp.waitForTimeout(500);
  await vp.locator('#cartClose').tap(); await vp.waitForTimeout(400);
  note('위시리스트: × 버튼으로 닫힌다', await vp.evaluate(() => document.getElementById('cartView').hidden));
  await vp.evaluate(() => window.openCartTab()); await vp.waitForTimeout(500);
  await swipe(vp, 195, 120, 420);
  note('위시리스트: 맨 위에서 아래로 끌면 닫힌다', await vp.evaluate(() => document.getElementById('cartView').hidden));
  await vp.evaluate(() => window.openCartTab()); await vp.waitForTimeout(500);
  await swipe(vp, 195, 120, 160);
  note('위시리스트: 조금만 끌면 그대로 열려 있다', await vp.evaluate(() => !document.getElementById('cartView').hidden));
  note('장바구니 화면 오류 없음', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.ctx.close();
}
// #16 새 홈: 랭킹 한 줄, 넘겨 보는 큰 카드, 폴더 카드 없음, 알림 종, 하단바 조금 작게
{
  const v = await open(browser, { login: true });
  const vp = v.page;
  const h = await vp.evaluate(() => {
    const r = (q) => document.querySelector(q).getBoundingClientRect();
    const svg = document.querySelector('.tabbar button svg').getBoundingClientRect();
    return {
      rank: document.getElementById('rankLine').textContent, rankShown: !document.getElementById('rank').hidden,
      rankVis: (() => { const l = document.getElementById('rankLine'); const i = l.querySelector('.rank-i'); const b = i && i.getBoundingClientRect(); const w = document.querySelector('.rank-win').getBoundingClientRect(); return [getComputedStyle(l).opacity, b && Math.round(b.width), Math.round(w.width), Math.round(w.height), getComputedStyle(i).color, l.className]; })(),
      rankSize: [parseFloat(getComputedStyle(document.querySelector('.rank-i')).fontSize), Math.round(r('#rank').height), Math.round(r('.search-wrap').top - r('#rank').bottom), Math.round(r('#rank').top - r('.logo').bottom)],
      heroGap: Math.round(r('#hero').top - r('.search-wrap').bottom),
      order: [r('#rank').top < r('.search-wrap').top, r('.search-wrap').bottom <= r('#hero').top, r('#hero').bottom <= r('#chips').top],
      slides: document.querySelectorAll('#heroTrack .hero-slide').length, slideW: Math.round(r('#heroTrack .hero-slide').width),
      fcard: getComputedStyle(document.getElementById('fCard')).display,
      tab: [Math.round(svg.width), parseFloat(getComputedStyle(document.querySelector('.tabbar button')).fontSize)],
      dot: !document.querySelector('#newsBtn .news-dot').hidden, bellLeftOfHelp: r('#newsBtn').right <= r('.m-actions .m-ic:last-child').left,
    };
  });
  note('랭킹: 맨 위에 1위가 보인다(폴더에 가장 많이 담긴 무드랩)', h.rankShown && h.rank === '1무드랩' && h.rankVis[0] === '1' && h.rankVis[1] > 40, h.rank + ' ' + JSON.stringify(h.rankVis));
  const gaps = await vp.evaluate(() => { const b = document.querySelector('.rank-badge').getBoundingClientRect(); const em = document.querySelector('.rank-i em'); const e = em.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(em); const num = rg.getBoundingClientRect(); const nm = document.createRange(); nm.setStart(em.nextSibling, 0); nm.setEnd(em.nextSibling, 1); return [Math.round(num.left - b.right), Math.round(nm.getBoundingClientRect().left - num.right)]; });
  note('랭킹·숫자·브랜드 이름 간격이 촘촘하다(배지~숫자 14px 이하, 숫자~이름 12px 이하)', gaps[0] <= 14 && gaps[1] <= 12, JSON.stringify(gaps));
  const badge = await vp.evaluate(() => { const b = document.querySelector('.rank-badge'); const cs = getComputedStyle(b); return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, icon: !!b.querySelector('svg'), text: b.textContent }; });
  note('랭킹 꼬리표: 검은 알약이 아니라 민트 네모 + 막대 아이콘', badge.bg === 'rgb(230, 247, 240)' && badge.radius === '6px' && badge.icon && badge.text === '랭킹', JSON.stringify(badge));
  note('홈 순서: 랭킹 → 검색 → 넘겨 보는 카드 → 카테고리', h.order.every(Boolean), JSON.stringify(h.order));
  note('랭킹 글자 14px·줄 높이 32px·위아래 여백 작게(16px 이하)', h.rankSize[0] === 14 && h.rankSize[1] === 32 && h.rankSize[2] <= 16 && h.rankSize[3] <= 16, JSON.stringify(h.rankSize));
  note('검색과 넘겨 보는 카드 사이 여백 20px', h.heroGap === 20, String(h.heroGap));
  note('넘겨 보는 카드 3장, 옆 카드가 살짝 보인다', h.slides === 3 && h.slideW < 390 - 32, JSON.stringify([h.slides, h.slideW]));
  note('홈 폴더 카드는 안 보인다', h.fcard === 'none', h.fcard);
  note('하단바 그림 22px·글자 11px(조금 작게)', h.tab[0] === 22 && h.tab[1] === 11, JSON.stringify(h.tab));
  note('알림 종은 이용 안내 왼쪽, 새 소식이 있으면 초록 점', h.bellLeftOfHelp && h.dot, JSON.stringify([h.bellLeftOfHelp, h.dot]));
  await vp.waitForTimeout(3500);
  const r2 = await vp.evaluate(() => document.getElementById('rankLine').textContent);
  note('랭킹: 잠시 뒤 2위로 넘어간다', r2 === '2소요', r2);
  const samples = await vp.evaluate(async () => { const out = []; for (let i = 0; i < 36; i++) { out.push(+getComputedStyle(document.getElementById('rankLine')).opacity); await new Promise((r) => setTimeout(r, 100)); } return out; });
  const dip = samples.findIndex((o) => o < 0.5);
  note('랭킹: 넘어갈 때만 잠깐 흐려지고 곧 다시 또렷해진다(0.1초마다 잰 값)', dip >= 0 && samples.slice(dip).some((o) => o === 1) && samples.filter((o) => o === 1).length >= 25, samples.map((o) => o.toFixed(1)).join(' '));
  await vp.locator('#heroTrack').evaluate((e) => e.scrollTo({ left: e.scrollWidth }));
  await vp.waitForTimeout(500);
  note('넘겨 보는 카드가 옆으로 넘어간다', await vp.evaluate(() => document.getElementById('heroTrack').scrollLeft > 100));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'home16.png') });
  if (shotDir) await vp.locator('.row').first().screenshot({ path: join(shotDir, 'rank-line.png') });
  await vp.evaluate(() => document.getElementById('rank').click()); await vp.waitForTimeout(500);
  const rl = await vp.evaluate(() => ({ open: rankDialog.open, list: [...document.querySelectorAll('#rankList li')].map((l) => l.textContent) }));
  note('랭킹을 누르면 1~10위 목록이 열린다', rl.open && rl.list[0] === '1무드랩' && rl.list[1] === '2소요' && rl.list.length === 5, JSON.stringify(rl));
  const rt = await vp.evaluate(() => { const t = document.querySelector('#rankDialog .sd-title'); const rg = document.createRange(); rg.selectNodeContents(t); const n = { getBoundingClientRect: () => { const r = document.querySelector('#rankList').getBoundingClientRect(); return { left: r.left + 4 }; } }; const cs = getComputedStyle(t); return [Math.round(rg.getBoundingClientRect().left), Math.round(n.getBoundingClientRect().left), cs.fontSize, cs.fontWeight, t.textContent, document.querySelector('.rank-badge').textContent]; });
  note('랭킹 창: 제목은 질문 한 줄(17px·덜 굵게), 아래 목록 칸과 왼쪽 줄 맞춤, 홈 표시는 랭킹', Math.abs(rt[0] - rt[1]) <= 1 && rt[2] === '17px' && +rt[3] <= 600 && rt[4] === '이번 주 사람들이 가장 많이 추가한 브랜드는?' && rt[5] === '랭킹', JSON.stringify(rt));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'rank.png') });
  await vp.evaluate(() => rankDialog.close());
  await vp.evaluate(() => document.getElementById('newsBtn').click()); await vp.waitForTimeout(500);
  const nw = await vp.evaluate(() => ({ open: newsDialog.open, n: document.querySelectorAll('#newsList .news-item').length, dot: !document.querySelector('#newsBtn .news-dot').hidden }));
  const ng = await vp.evaluate(() => { const d = document.getElementById('newsDialog').getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(document.querySelector('#newsDialog .sd-title')); const t = rg.getBoundingClientRect(); const items = document.querySelectorAll('#newsList .news-item'); const first = items[0].getBoundingClientRect(); const b = document.getElementById('newsList'); b.scrollTop = b.scrollHeight; const last = items[items.length - 1].getBoundingClientRect(); return [Math.round(t.top - d.top), Math.round(first.top - t.bottom), Math.round(b.getBoundingClientRect().bottom - last.bottom)]; });
  note('새 소식: 제목 위·아래 여백이 같고(차이 4px 이하) 맨 아래 칸 밑 여백 28px 이상', Math.abs(ng[0] - ng[1]) <= 4 && ng[2] >= 28, JSON.stringify(ng));
  const titles = await vp.evaluate(() => [...document.querySelectorAll('.sd-title, .my-top h1, .cart-head h1')].map((e) => [e.textContent.trim(), getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight]));
  note('창·화면 제목이 모두 20px 이하·600 이하(너무 크고 굵지 않게)', titles.length >= 5 && titles.every((t) => parseFloat(t[1]) <= 20 && +t[2] <= 600), JSON.stringify(titles));
  note('로고 글자 20px(아주 조금 크게)', await vp.evaluate(() => getComputedStyle(document.querySelector('header .logo')).fontSize) === '20px');
  note('알림 종을 누르면 새 소식이 열리고 초록 점이 사라진다', nw.open && nw.n >= 3 && !nw.dot, JSON.stringify(nw));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'news.png') });
  await vp.evaluate(() => newsDialog.close());
  const w = () => vp.evaluate(() => [...document.querySelectorAll('.tabbar button')].map((b) => b.dataset.tab + ':' + getComputedStyle(b).fontWeight).join(' '));
  const w0 = await w();
  await vp.evaluate(() => document.querySelector('.tabbar [data-tab=folder]').click()); await vp.waitForTimeout(400);
  const w1 = await w();
  await vp.evaluate(() => folderDialog.close()); await vp.waitForTimeout(300);
  const w2 = await w();
  note('하단바: 고른 칸만 글자가 굵다(홈 → 내 폴더 → 닫으면 다시 홈)', /home:700/.test(w0) && (w0.match(/:700/g) || []).length === 1 && /folder:700/.test(w1) && (w1.match(/:700/g) || []).length === 1 && w2 === w0, [w0, w1, w2].join(' / '));
  note('새 홈 화면 오류 없음', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.ctx.close();
}
// #17 마이: 전체 화면 — 프로필, 숫자 세 칸, 묶음 메뉴, 비밀번호는 따로 띄움
{
  const v = await open(browser, { login: true });
  const vp = v.page;
  await vp.evaluate(() => document.querySelector('.tabbar [data-tab=my]').click()); await vp.waitForTimeout(700);
  const my = await vp.evaluate(() => ({
    shown: !document.getElementById('myView').hidden, tabOn: document.querySelector('.tabbar [data-tab=my]').classList.contains('on'),
    av: document.getElementById('myAv').textContent, name: document.getElementById('myName').textContent,
    stats: [...document.querySelectorAll('.my-stats em')].map((e) => e.textContent),
    rows: [...document.querySelectorAll('#myView .my-row > span:first-of-type')].map((e) => e.textContent),
    pwInline: !!document.querySelector('#myView input[type=password]'),
    rowH: Math.min(...[...document.querySelectorAll('#myView .my-row')].map((e) => e.getBoundingClientRect().height)),
  }));
  note('마이 화면 제목과 하단바 글자가 Mypage', await vp.evaluate(() => document.querySelector('.my-top h1').textContent === 'Mypage' && document.querySelector('.tabbar [data-tab=my]').textContent.trim() === 'Mypage'));
  note('마이: 전체 화면으로 열리고 하단바 마이가 굵다', my.shown && my.tabOn, JSON.stringify([my.shown, my.tabOn]));
  note('마이: 프로필 앞글자·이름', my.av === 'T' && my.name === 'tester', JSON.stringify([my.av, my.name]));
  note('마이: 숫자 세 칸(위시리스트 2·담은 브랜드 5·내 폴더 1)', JSON.stringify(my.stats) === '["2","5","1"]', JSON.stringify(my.stats));
  note('마이: 메뉴 7줄(쇼핑·소식·계정), 한 줄 44px 이상, 비밀번호 칸은 화면에 없음', my.rows.length === 7 && my.rowH >= 44 && !my.pwInline, JSON.stringify([my.rows, my.rowH, my.pwInline]));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'my.png'), fullPage: false });
  await vp.locator('#myView .my-row[data-my=pw]').tap(); await vp.waitForTimeout(500);
  note('마이: 비밀번호 변경을 누르면 아래에서 창이 올라온다', await vp.evaluate(() => pwDialog.open && !!document.querySelector('#pwDialog #myNewPw')));
  if (shotDir) await vp.screenshot({ path: join(shotDir, 'my-pw.png') });
  await vp.evaluate(() => pwDialog.close()); await vp.waitForTimeout(300);
  note('마이: 창을 닫으면 하단바는 그대로 마이', await vp.evaluate(() => document.querySelector('.tabbar [data-tab=my]').classList.contains('on') && !document.getElementById('myView').hidden));
  await vp.locator('#myWish').tap(); await vp.waitForTimeout(600);
  note('마이 → 위시리스트가 열린다', await vp.evaluate(() => !document.getElementById('cartView').hidden && document.getElementById('myView').hidden));
  await vp.locator('#cartClose').tap(); await vp.waitForTimeout(400);
  note('위시리스트를 닫으면 마이로 돌아간다', await vp.evaluate(() => document.getElementById('cartView').hidden && !document.getElementById('myView').hidden));
  await vp.locator('#myView .my-row[data-my=folder]').tap(); await vp.waitForTimeout(500);
  note('마이 → 내 폴더 관리 창이 열린다', await vp.evaluate(() => folderDialog.open));
  await vp.evaluate(() => folderDialog.close()); await vp.waitForTimeout(300);
  await vp.evaluate(() => document.querySelector('.tabbar [data-tab=home]').click()); await vp.waitForTimeout(400);
  note('홈 칸을 누르면 마이가 닫힌다', await vp.evaluate(() => document.getElementById('myView').hidden));
  note('마이 화면 오류 없음', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.ctx.close();
}
// 주간 랭킹 임시 순서 모드(RANK_DEMO): 실제 데이터 대신 브랜드를 섞은 순서, 새로 열어도 같은 주에는 같은 순서
{
  const ord = [];
  for (let k = 0; k < 2; k++) {
    const v = await open(browser, { login: true, demoRank: true });
    ord.push({ demoQ: v.calls.some((c) => c.path.endsWith('/brands') && /status=eq.ready/.test(c.query)) });
    Object.assign(ord[ord.length - 1], await v.page.evaluate(() => ({ list: [...document.querySelectorAll('#rankList li span')].map((e) => e.textContent), line: document.getElementById('rankLine').textContent, shown: !document.getElementById('rank').hidden })));
    await v.ctx.close();
  }
  const names = ['온결', '무드랩', '소요', '헤이든', '파인스튜디오', 'SAFARISPOT', 'BAGSHOP', 'XLIM'];
  note('주간 랭킹(임시 순서): 실제 순위 대신 브랜드 목록을 섞어 8개가 다 나오고, 다시 열어도 같은 순서', ord[0].demoQ && ord[0].shown && ord[0].list.length === 8 && names.every((n) => ord[0].list.includes(n)) && JSON.stringify(ord[0].list) === JSON.stringify(ord[1].list) && ord[0].line === '1' + ord[0].list[0], JSON.stringify(ord));
}
// 주간 랭킹: 지난 7일 조건으로 묻는다
{
  const v = await open(browser, { login: true });
  const q = v.calls.find((c) => c.path.endsWith('/user_brands') && /added_at=gte\./.test(c.query));
  note('주간 랭킹: 지난 7일(added_at) 조건으로 데이터를 묻는다', !!q, q ? q.query.slice(0, 80) : '');
  await v.ctx.close();
}
// 가격 없는 것(룩북·시즌 소개·매장 전용 0원 상품)은 상품 목록·사이즈 목록에 안 나온다
{
  const v = await open(browser, { login: true });
  const list = v.calls.filter((c) => c.path.endsWith('/product_group') && c.method === 'GET');
  const main = list.filter((c) => /offer/.test(c.query));
  note('상품 목록은 가격·사진 있는 것만 묻는다(min_price > 0, image 있음)', main.length > 0 && main.every((c) => /min_price=gt.0/.test(c.query) && /image=not.is.null/.test(c.query) && /image=neq./.test(c.query)), main.map((c) => c.query.slice(0, 40)).join(' | '));
  await v.ctx.close();
}
// #20 대시보드 카드 3장: 어울리는 브랜드 / 계절 추천 / 이번 주 신상
{
  const v = await open(browser, { login: true });
  const vp = v.page;
  await vp.waitForTimeout(800);
  const d = await vp.evaluate(() => ({
    shown: !document.getElementById('hero').hidden,
    name: document.getElementById('dfName').textContent,
    why: document.getElementById('dfWhy').textContent,
    picks: [...document.querySelectorAll('#dfList .df-row')].map((r) => r.querySelector('a,span').textContent),
    links: [...document.querySelectorAll('#dfList .df-row a')].map((a) => a.getAttribute('href')),
    season: document.getElementById('dsTitle').textContent, month: document.getElementById('dsMonth').textContent, chips: document.querySelectorAll('#dsChips span').length,
    sCount: document.getElementById('dsCount').textContent, nCount: document.getElementById('dnCount').textContent, thumbs: document.querySelectorAll('#dnThumbs img').length,
    expect: window.dashSeason().title.replace('<br>', ''),
  }));
  const fit = await vp.evaluate(() => [...document.querySelectorAll('#heroTrack .hero-slide')].map((s) => { const r = s.getBoundingClientRect(); return Math.max(0, ...[...s.querySelectorAll('*')].map((e) => Math.round(e.getBoundingClientRect().bottom - r.bottom))); }));
  note('대시보드: 카드 안 내용이 카드 밖으로 잘리지 않는다', fit.every((x) => x <= 0), JSON.stringify(fit));
  note('대시보드: 로그인하면 카드가 보이고 이름이 들어간다', d.shown && d.name === 'tester', JSON.stringify([d.shown, d.name]));
  note('어울리는 브랜드: 안 담은 브랜드 3개, 비슷한 것(SAFARISPOT·XLIM)이 먼저, 먼 것(BAGSHOP)은 마지막', d.picks.length === 3 && d.picks[2] === 'BAGSHOP' && d.picks.slice(0, 2).sort().join() === 'SAFARISPOT,XLIM' && d.links.every((h) => /shop\.test/.test(h)), JSON.stringify([d.picks, d.links]));
  note('어울리는 브랜드: 추천 이유(종류·가격대)가 보인다', /코트·니트 위주/.test(d.why) && !/기타/.test(d.why) && /만 원/.test(d.why), d.why);
  note('계절 카드: 이번 달 계절 제목·꼬리표·개수', d.season === d.expect && /월$/.test(d.month) && d.chips >= 4 && /12개/.test(d.sCount), JSON.stringify([d.season, d.month, d.chips, d.sCount]));
  note('신상 카드: 이번 주 개수와 사진 3장', d.nCount === '12' && d.thumbs === 3, JSON.stringify([d.nCount, d.thumbs]));
  const q = v.calls.filter((c) => c.path.endsWith('/product_group') && /first_seen_at=gte/.test(c.query));
  note('신상 카드: 지난 7일(first_seen_at) 조건으로 묻는다', q.length >= 1, String(q.length));
  if (shotDir) await vp.locator('#hero').screenshot({ path: join(shotDir, 'dash-1.png') });
  let n = v.calls.length;
  await vp.evaluate(() => document.querySelector('#dfList [data-add-brand]').click()); await vp.waitForTimeout(700);
  const ins = v.calls.slice(n).find((c) => c.path.endsWith('/user_brands') && c.method === 'POST');
  note('어울리는 브랜드: + 담기를 누르면 내 폴더에 담는 요청을 보낸다', !!ins && await vp.evaluate(() => /담았어요/.test(document.querySelector('#dfList [data-add-brand]').textContent) || myFolderIds.length === 6), ins ? 'POST user_brands' : '없음');
  await vp.locator('#heroTrack').evaluate((e) => e.scrollTo({ left: e.querySelector('.ds').offsetLeft - 16 })); await vp.waitForTimeout(400);
  if (shotDir) await vp.locator('#hero').screenshot({ path: join(shotDir, 'dash-2.png') });
  n = v.calls.length;
  await vp.evaluate(() => document.querySelector('[data-hero=season]').click()); await vp.waitForTimeout(1200);
  const sq = v.calls.slice(n).find((c) => c.path.endsWith('/product_group') && /offer/.test(c.query) && /categories=ov/.test(c.query));
  note('계절 카드를 누르면 그 종류들로 거른다', !!sq && /padding|tshirt|jacket|shirt/.test(sq.query), sq ? sq.query.match(/categories=ov\.[^&]*/)[0].slice(0, 80) : '없음');
  await vp.locator('#heroTrack').evaluate((e) => e.scrollTo({ left: e.scrollWidth })); await vp.waitForTimeout(400);
  if (shotDir) await vp.locator('#hero').screenshot({ path: join(shotDir, 'dash-3.png') });
  await vp.evaluate(() => document.querySelector('[data-hero=recent]').click()); await vp.waitForTimeout(600);
  note('신상 카드를 누르면 최신순', await vp.evaluate(() => document.getElementById('sort').value === 'recent'));
  note('대시보드 화면 오류 없음', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.ctx.close();
}
{
  const v = await open(browser, { login: false });
  note('로그인 전에는 대시보드 카드를 숨긴다', await v.page.evaluate(() => document.getElementById('hero').hidden));
  await v.ctx.close();
}
// PC 폭: 장바구니 버튼이 사진 안 오른쪽 아래, 머리글에 장바구니 메뉴
{
  const v = await open(browser, { login: true, width: 1280, height: 900 });
  const pc = await v.page.evaluate(() => {
    const cw = document.querySelector('#grid .cw'); const img = cw.querySelector('.imgwrap').getBoundingClientRect(); const r = cw.querySelector('.cart-btn').getBoundingClientRect();
    const nav = document.getElementById('cartNavBtn').getBoundingClientRect();
    return { inImg: r.right <= img.right && r.bottom <= img.bottom && img.right - r.right <= 12 && img.bottom - r.bottom <= 12, nav: nav.width > 0 };
  });
  note('PC: 장바구니 버튼이 사진 오른쪽 아래, 머리글에 장바구니 메뉴', pc.inImg && pc.nav, JSON.stringify(pc));
  if (shotDir) await v.page.screenshot({ path: join(shotDir, 'cart-pc.png') });
  await v.ctx.close();
}
// 로그인 전에는 장바구니 버튼이 로그인 창을 연다
{
  const v = await open(browser, { login: false });
  note('로그인 전: 상품이 없어 장바구니 버튼도 없다(오류 없음)', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
  await v.page.evaluate(() => window.openCartTab()); await v.page.waitForTimeout(500);
  note('로그인 전: 장바구니 화면에 로그인 안내', await v.page.evaluate(() => /로그인/.test(document.getElementById('cartList').textContent)));
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
