// 화면 기능 안전망(T-04 0단계). 가짜 데이터로 web/ 을 띄워 지금 기능이 살아 있는지 누르며 확인한다.
// Supabase 로 가는 요청은 전부 가로채 가짜로 답한다 — 실제 데이터베이스·계정에는 아무것도 보내지 않는다.
// 실행: node scripts/ui-smoke.mjs [사진 폴더]   (playwright 필요: npm i 로 이미 있음)
// 리뉴얼 뒤에도 같은 항목이 통과해야 한다(기능 그대로, design-kit DD-2).
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
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', locale: 'ko-KR' });
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

const results = [];
async function check(name, fn) {
  try { const ok = await fn(); results.push([ok ? '통과' : '실패', name]); }
  catch (e) { results.push(['실패', `${name} — ${e.message.split('\n')[0].slice(0, 90)}`]); }
}
const tab = (page, name) => page.locator(`.tabbar [data-tab="${name}"]`).click();
const isOpen = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; if (el.tagName === 'DIALOG') return el.open; return !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; }, sel);
const shot = async (page, n) => { if (shotDir) await page.screenshot({ path: join(shotDir, n + '.png') }); };
const closeAll = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

const browser = await chromium.launch();

// 1) 로그인 전
{
  const s = await open(browser, { login: false });
  await check('로그인 전: 초대 안내와 로그인 버튼이 보인다', async () => (await s.page.getByText('로그인 / 회원가입').first().isVisible()));
  await check('로그인 전: 로그인 버튼을 누르면 로그인 창이 열린다', async () => { await s.page.getByText('로그인 / 회원가입').first().click(); await s.page.waitForTimeout(400); return isOpen(s.page, '#authDialog'); });
  await shot(s.page, '1-logged-out');
  await check('로그인 전: 화면 오류 없음', async () => s.errors.length === 0 || (console.log(s.errors), false));
  await s.ctx.close();
}

// 2) 로그인 후
{
  const s = await open(browser, { login: true });
  const p = s.page;
  await check('홈: 내 폴더 브랜드 상품을 불러온다', async () => s.calls.some((c) => c.path.endsWith('/product_group') && /brand_id=in\./.test(c.query)));
  await check('홈: 상품 카드가 그려진다', async () => (await p.locator('#grid .card').count()) > 0);
  await shot(p, '2-home');
  await check('검색: 검색어를 넣으면 그 말로 상품을 찾는다', async () => {
    const n = s.calls.length; await p.fill('#q', '코트'); await p.press('#q', 'Enter'); await p.waitForTimeout(1500);
    return s.calls.slice(n).some((c) => c.path.endsWith('/product_group') && c.query.includes('코트'));
  });
  try { await p.fill('#q', ''); await p.press('#q', 'Enter'); await p.waitForTimeout(800); } catch {}
  await check('분류: 분류 칩을 누르면 그 분류로 거른다', async () => {
    const chip = p.locator('#chips button, #chips .chip').nth(1); const n = s.calls.length; await chip.click(); await p.waitForTimeout(1500);
    return s.calls.slice(n).some((c) => c.path.endsWith('/product_group') && /categories/.test(c.query));
  });
  await check('폴더: 폴더 관리 창이 열리고 담은 브랜드 5개가 보인다', async () => {
    await tab(p, 'folder'); await p.waitForTimeout(700); await shot(p, '3-folder');
    return (await isOpen(p, '#folderDialog')) && (await p.locator('#folderList input[type=checkbox]').count()) >= 5;
  });
  await check('폴더: 브랜드 체크를 풀면 폴더에서 빼는 요청을 보낸다', async () => {
    const n = s.calls.length; await p.locator('#folderList input[type=checkbox]:checked').nth(1).click(); await p.waitForTimeout(900);
    return s.calls.slice(n).some((c) => c.path.endsWith('/user_brands') && c.method === 'DELETE');
  });
  await closeAll(p);
  await check('등록: 브랜드 등록 창이 열리고 주소를 넣어 등록 요청을 보낸다', async () => {
    await tab(p, 'add'); await p.waitForTimeout(500); if (!(await isOpen(p, '#addDialog'))) return false; await shot(p, '4-add');
    const n = s.calls.length; await p.fill('#addUrl', 'https://brand.test'); await p.locator('#addDialog').getByText('등록하기').click(); await p.waitForTimeout(1500);
    return s.calls.slice(n).some((c) => c.path.startsWith('/functions/') || (c.path.endsWith('/brands') && c.method !== 'GET'));
  });
  await closeAll(p);
  await check('AI: AI 서비스 화면이 열린다', async () => { await tab(p, 'ai'); await p.waitForTimeout(600); await shot(p, '5-ai'); return isOpen(p, '#aiView'); });
  try { await tab(p, 'home'); await p.waitForTimeout(500); } catch {}
  await check('마이: 마이 창이 열린다', async () => { await tab(p, 'my'); await p.waitForTimeout(600); await shot(p, '6-my'); return isOpen(p, '#myDialog'); });
  await closeAll(p);
  await check('질문하기: 질문 창이 열린다', async () => { await p.locator('#qaFab').click(); await p.waitForTimeout(600); await shot(p, '7-qa'); return isOpen(p, '#qaPanel'); });
  await check('로그인 후: 화면 오류 없음', async () => s.errors.length === 0 || (console.log(s.errors), false));
  await s.ctx.close();
}

await browser.close();
server.close();
for (const [r, n] of results) console.log(`${r} ${n}`);
const fails = results.filter((r) => r[0] === '실패').length;
console.log(fails ? `실패 ${fails}건 / ${results.length}` : `모두 통과 ${results.length}건`);
process.exit(fails ? 1 : 0);
