// 해외 쇼핑몰(ecbeing, 예: CA4LA)·원화 환산 시험(#12). 인터넷에 접속하지 않는다.
// 실행: node scripts/test-ecbeing.mjs  (npm run test:ecbeing)
import { parseEcbeingList, jpCategory } from '../src/adapters/ecbeing.js';
import { toKrw, FALLBACK_KRW_RATE } from '../src/lib/fx.js';
import { classifyItem } from '../src/lib/taxonomy.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '통과 ' : '실패 ') + m); if (!c) fail++; };

// 실제 목록 HTML(2026-11-19 ca4la.com)에서 상품 한 칸을 줄인 것
const HTML = `
<div class="block-pickup-list-p--item-body js-enhanced-ecommerce-item">
  <div class="block-pickup-list-p--image"><a href="/shop/g/gCLB00638-4550469977567" class="js-enhanced-ecommerce-image"><figure class="img-center"><img alt="PEANUTS x CA4LA LOGO BERET" src="/img/usr/lazyloading.png" data-src="https://www.ca4la.com/img/goods/CLB00638/CLB00638_BEIGE_S.jpg" class="lazyload"></figure></a></div>
  <div class="block-pickup-list-p--goods-name"><a href="/shop/g/gCLB00638-4550469977567" class="js-enhanced-ecommerce-goods-name">PEANUTS x CA4LA LOGO BERET</a></div>
  <div class="block-pickup-list-p--price price js-enhanced-ecommerce-goods-price">&#165;14,850</div>
  <ul class="colorchip-ul">
    <li class="colorchip-li"><span class="colorchip-chip" data-img-src="https://www.ca4la.com/img/goods/CLB00638/CLB00638_BEIGE_S.jpg"></span></li>
    <li class="colorchip-li"><span class="colorchip-chip" data-img-src="https://www.ca4la.com/img/goods/CLB00638/CLB00638_BLACK_S.jpg"></span></li>
  </ul>
</div>`;
const [it] = parseEcbeingList(HTML, 'https://www.ca4la.com');
ok(it && it.title === 'PEANUTS x CA4LA LOGO BERET', '상품 이름을 읽는다');
ok(it && it.url === 'https://www.ca4la.com/shop/g/gCLB00638-4550469977567' && it.code === 'CLB00638-4550469977567', '상품 주소·번호를 읽는다');
ok(it && it.yen === 14850, '엔화 가격 "¥14,850" → 14850');
ok(it && it.images[0] === 'https://www.ca4la.com/img/goods/CLB00638/CLB00638_BEIGE.jpg' && it.images.length === 2, '사진은 큰 판(_S 뗀 주소)으로, 색상별로');
ok(it && it.colors.join(',') === 'BEIGE,BLACK', '색상 칩에서 색 이름을 읽는다');

ok(toKrw(14850, 8.3574) === 124110, '엔화 → 원화(10원 단위 반올림)');
ok(toKrw(14850, null) === null, '환율을 모르면 가격 없음(엉뚱한 숫자를 보이지 않게)');
ok(FALLBACK_KRW_RATE.JPY > 5 && FALLBACK_KRW_RATE.JPY < 15, '엔화 대략치 환율이 상식 범위');

ok(jpCategory('ニットキャップ') === 'Hats > Beanie', 'ニットキャップ → 비니 분류');
ok(jpCategory('ハット') === 'Hats > Hat' && jpCategory('その他の帽子') === 'Hats > Hat', 'ハット·その他の帽子 → 모자');
ok(jpCategory('ニット') === 'Tops', '옷 가게의 ニット(니트)는 비니가 아니라 상의');
ok(classifyItem('PEANUTS x CA4LA SNOOPY LINE KNIT', 'Hats > Beanie')[0] === 'beanie', '모자 가게의 "KNIT"는 니트 옷이 아니라 비니');
ok(classifyItem('HUMBERT20', 'Hats > Newsboy cap')[0] === 'beret_hunting', '이름에 단서가 없으면 쇼핑몰 분류(キャスケット)를 따른다');

console.log(fail ? `실패 ${fail}건` : '모두 통과');
process.exit(fail ? 1 : 0);
