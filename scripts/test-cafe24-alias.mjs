// cafe24 어댑터의 "sitemap이 다른 주소를 가리킬 때" 판단 시험(#19).
// 같은 쇼핑몰의 다른 주소(같은 경로에 같은 상품) → 받아들임, 다른 회사 쇼핑몰(같은 경로에 다른 상품 또는 없음) → 버림.
// 실제 쇼핑몰에는 요청하지 않고 이 컴퓨터 안에 가짜 쇼핑몰 서버를 띄워 시험한다.
// 실행: node scripts/test-cafe24-alias.mjs
import { createServer } from 'node:http';
import { isSameMall } from '../src/adapters/cafe24.js';

const page = (title) => `<!doctype html><html><head><meta property="og:title" content="${title}"></head><body></body></html>`;
const serve = (titleFor) => new Promise((ok) => {
  const s = createServer((req, res) => {
    const t = titleFor(req.url);
    if (!t) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(t));
  }).listen(0, '127.0.0.1', () => ok(s));
});
const id = (u) => (u.match(/\/product\/[^/]+\/(\d+)/) || [])[1];
const shop = await serve((u) => id(u) && 'Hoodie ' + id(u)); // 우리 주소
const alias = await serve((u) => id(u) && 'Hoodie ' + id(u)); // 같은 쇼핑몰 다른 주소
const other = await serve((u) => id(u) && 'Sofa ' + id(u)); // 다른 회사 쇼핑몰
const base = `http://127.0.0.1:${shop.address().port}`;
const urls = (srv) => [1, 2, 3].map((n) => `http://127.0.0.1:${srv.address().port}/product/item-${n}/${n}/`);

const results = [
  ['같은 쇼핑몰의 다른 주소는 받아들인다', (await isSameMall(base, urls(alias))) === true],
  ['다른 회사 쇼핑몰 주소는 버린다', (await isSameMall(base, urls(other))) === false],
  ['상품 주소가 없으면 버린다', (await isSameMall(base, ['http://127.0.0.1:1/about'])) === false],
];
for (const s of [shop, alias, other]) { s.closeAllConnections(); s.close(); }
for (const [name, ok] of results) console.log(`${ok ? '통과' : '실패'} ${name}`);
const fails = results.filter((r) => !r[1]).length;
console.log(fails ? `실패 ${fails}건` : `모두 통과 ${results.length}건`);
process.exitCode = fails ? 1 : 0; // process.exit()로 바로 끄면 윈도에서 열린 연결 정리 중에 멈춤 오류가 난다
