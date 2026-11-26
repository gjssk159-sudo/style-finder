// 브랜드 등록 때 "쇼핑몰인지" 가려내는 기준 시험(#21). 인터넷에 접속하지 않고 짧은 예시 HTML로 본다.
// 기준: 처음 보는 쇼핑몰 프로그램이면 첫 화면에 쇼핑몰 흔적(상품 링크·가격·장바구니/구매·상품 정보)이 2가지 이상이어야 등록.
// 실행: node scripts/test-shop-signals.mjs   (npm run test:shop-signals)
import { shopSignals } from '../supabase/functions/register-brand/signals.ts';

const CASES = [
  ['쇼핑몰(상품 링크+가격+장바구니)', '<a href="/product/wool-coat/12/">Wool coat</a><span>128,000원</span><a href="/order/basket.html">장바구니</a>', (n) => n >= 2],
  ['해외 쇼핑몰(products 링크+₩ 가격+add to cart)', '<a href="/products/tee">Tee</a><span class="price">₩ 59,000</span><button>Add to cart</button>', (n) => n >= 2],
  ['상품 정보(JSON-LD)+가격만 있는 쇼핑몰', '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"59000"}}</script>', (n) => n >= 2],
  ['블로그 글', '<h1>오늘의 일기</h1><p>날씨가 좋아서 산책을 했다.</p><a href="/post/123">다음 글</a>', (n) => n < 2],
  ['회사 소개 사이트', '<h1>About us</h1><p>We build software.</p><a href="/careers">Careers</a>', (n) => n < 2],
  ['빈 페이지', '<html><body></body></html>', (n) => n === 0],
];
let fail = 0;
for (const [name, html, ok] of CASES) {
  const n = shopSignals(html);
  const pass = ok(n);
  if (!pass) fail++;
  console.log(`${pass ? '통과' : '실패'} ${name} — 흔적 ${n}개`);
}
console.log(fail ? `실패 ${fail}건 / ${CASES.length}` : `모두 통과 ${CASES.length}건`);
process.exitCode = fail ? 1 : 0;
