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
const brands = ['온결', '무드랩', '소요', '헤이든', '파인스튜디오'].map((n, i) => ({ id: 100 + i, name: n, type: 'cafe24', status: 'active', added_by: null }));
const products = Array.from({ length: 12 }, (_, i) => ({
  id: 1000 + i, brand: brands[i % 5].name, brand_id: brands[i % 5].id,
  title: ['울 블렌드 오버핏 싱글 코트', '코튼 와이드 데님 팬츠', '라운드넥 캐시미어 니트', '레더 미니 숄더백', '헤비 코튼 후드 집업', '스트라이프 옥스퍼드 셔츠'][i % 6],
  title_norm: '', categories: ['outer'], colors: ['black'], sizes: ['S', 'M', 'L'], min_price: 59000 + i * 1000, max_price: 59000 + i * 1000,
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
  await open2(); await p.waitForTimeout(700);
  let r = await rectOf(p, sel);
  await swipe(p, 195, r.top + 18, r.top + 60);
  note(`${label}: 손잡이를 조금 끌어도 뒤 화면이 안 움직인다`, (await scrollY(p)) === base, 'scrollY=' + (await scrollY(p)));
  r = await rectOf(p, sel);
  if (await dlgOpen(p, sel)) {
    await swipe(p, 195, r.top + r.h * 0.5, r.top + r.h * 0.5 + 90);
    note(`${label}: 본문을 아래로 끌어도 뒤 화면이 안 움직인다`, (await scrollY(p)) === base, 'scrollY=' + (await scrollY(p)));
    await swipe(p, 195, 60, 160);
    note(`${label}: 바깥을 끌어도 뒤 화면이 안 움직인다`, (await scrollY(p)) === base, 'scrollY=' + (await scrollY(p)));
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
    const sc = document.getElementById('subChips'), row = sc.querySelector('.subrow'), cnt = document.getElementById('subCount');
    return { subBottom: r(sc).bottom, gridTop: r(document.getElementById('grid')).top, rowRight: r(row).right, cntLeft: r(cnt).left };
  });
  note('세부 분류 줄이 상품 카드를 덮지 않는다', m.subBottom <= m.gridTop, `줄 아래 ${m.subBottom} · 카드 위 ${m.gridTop}`);
  note('개수 표시가 세부 분류 버튼을 가리지 않는다', m.rowRight <= m.cntLeft, `줄 끝 ${m.rowRight} · 개수 ${m.cntLeft}`);
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
note('화면 오류 없음', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
await s.ctx.close();
await browser.close();
server.close();
for (const [r2, n] of results) console.log(`${r2} ${n}`);
const fails = results.filter((x) => x[0] === '실패').length;
console.log(fails ? `실패 ${fails}건 / ${results.length}` : `모두 통과 ${results.length}건`);
process.exit(fails ? 1 : 0);
