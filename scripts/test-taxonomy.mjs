// 카테고리 분류 시험(#5). 실제 수집 데이터의 상품명·쇼핑몰 분류로 만든 사례.
// 실행: node scripts/test-taxonomy.mjs   (npm run test:taxonomy)
// [상품명, 쇼핑몰 분류, 기대 카테고리 또는 기대 갈래(group:xxx), 설명]
import { classifyItem, GROUPS } from '../src/lib/taxonomy.js';

const groupOf = (id) => (GROUPS.find((g) => g.children.includes(id)) || {}).id || '?';
const CASES = [
  // ── 고칠 것: 이름이 분명한데 쇼핑몰 갈래가 덮어씀 (2026-11-08 사용자 제보 #5) ──
  ['SHIRRING MIDI SKIRT WHITE', 'BOTTOMS', 'group:dress_skirt', '스커트를 쇼핑몰이 BOTTOMS에 넣어도 스커트'],
  ['KNIT PLEATS SKIRT WINE', 'BOTTOMS > ALL > SHOP', 'group:dress_skirt', '니트 스커트도 스커트'],
  ['PADDING SKIRT / BLACK', 'Bottoms, test', 'group:dress_skirt', '패딩 스커트는 스커트'],
  ['CHIFFON SHIRRING ONE PIECE DARK GREEN', 'DRESSES > TOPS > ALL', 'group:dress_skirt', '원피스를 TOPS 경로에 넣어도 원피스'],
  ['Textured Cut-off Dress', 'mono prive > ALL > Top', 'group:dress_skirt', '드레스는 원피스·스커트 갈래'],
  ['STAR DRESS (BLACK)', 'TOP > ALL', 'group:dress_skirt', '드레스'],
  // ── 고칠 것: 쇼핑몰 분류 칸에 메뉴 전체가 들어온 경우는 믿지 않는다 ──
  ['Bluesf M-65 field jacket', 'Shop > Bluefriday > Men > Bottom > Acc > Top', 'group:outer', '메뉴 나열이면 상품명대로(재킷)'],
  ['Bluesf 807_roll-up jeans', 'Shop > Bluefriday > Bottom > Acc > Women > Top', 'group:bottom', '메뉴 나열이면 상품명대로(청바지)'],
  ['Bluesf vintage washed hoodie jacket_KH', 'Shop > Bluefriday > Men > Bottom > Acc > Top', 'group:outer', '메뉴 나열이면 상품명대로(후드 재킷)'],
  // ── 고칠 것: "_" 뒤 옵션 이름을 종류로 읽음 ──
  ['[2nd Drop 9.16] BUTTON HAT_SHEARLING CREAM', '', 'group:cap', '"_" 뒤 소재(SHEARLING)가 아니라 앞의 HAT'],
  ['NETTING SCARF_KNIT BEIGE (3차리오더)', '', 'group:acc', '"_" 뒤 KNIT 가 아니라 앞의 SCARF'],
  // ── 지킬 것: "_" 앞이 브랜드·컬렉션 이름이면 뒤에서 종류를 찾는다 ──
  ['HOTDRYGREY_Twisted ring 01', '', 'group:acc', '앞이 브랜드명이면 뒤의 ring'],
  ['WOODY_CARGO BURMUDA SHORT (KHAKI)', '', 'group:bottom', '앞이 컬렉션명이면 뒤의 SHORT'],
  ['Symmetric s-sleeve_t-shirts #14', '', 'tshirt', '반팔(s-sleeve) 티셔츠는 긴팔이 아님(약한 단어 sleeve 로 정하지 않음)'],
  ['Symmetric l-sleeve_t-shirts #15', '', 'tshirt', '이 상품명은 긴팔 단서가 약해 지금처럼 티셔츠로 둠'],
  // ── 지킬 것: 원래 의도한 동작 ──
  ['Vintage Dyed Base Hoodie Zip-up (Black)', 'Shop > All > Top', 'group:top', '집업 후드를 쇼핑몰이 TOP에 넣으면 상의(애매한 상의↔아우터는 쇼핑몰을 따름)'],
  ['(MEN) Layer Zip Hoodie Ⅱ Black', 'OUTER > Shop > ALL', 'group:outer', '집업 후드를 쇼핑몰이 OUTER에 넣으면 아우터'],
  ['COTTON BOOTCUT PANTS', '', 'group:bottom', '쇼핑몰 분류 없으면 상품명'],
  ['DENIM SKIRT', '', 'group:dress_skirt', '마지막 명사가 본체(데님 스커트 = 스커트)'],
  ['KNIT VEST', '', 'group:outer', '니트 베스트 = 베스트'],
  ['FLEECE EAR WARMER BROWN', 'ALL > SHOP > ACCESSORIES', 'group:acc', '귀마개는 소품(쇼핑몰 ACC 를 따름)'],
  ['LEATHER BIKER JACKET', '', 'group:outer', '레더 재킷'],
  ['Authentic Denim Wind Breaker (Indigo)', '홈 > PRODUCTS > Outer > Jacket', 'group:outer', '데님 윈드브레이커 = 아우터(소재 단어 denim 은 쇼핑몰 갈래를 따름)'],
  ['Over Shirt Denim Grey', 'HATCHINGROOM > Shirt', 'group:top', '오버셔츠 데님 = 셔츠(쇼핑몰 Shirt 를 따름)'],
  ['S CLEF WRAP SKIRT PANTS (BLACK)', '홈 > PRODUCTS > Bottom > SKIRT', 'group:dress_skirt', '쇼핑몰이 Bottom > SKIRT 로 정확히 말하면 스커트'],
];

let fail = 0;
for (const [title, raw, want, why] of CASES) {
  const got = classifyItem(title, raw)[0];
  const ok = want.startsWith('group:') ? groupOf(got) === want.slice(6) : got === want;
  if (!ok) fail++;
  console.log(`${ok ? '통과' : '실패'} ${why} — "${title}" → ${got}(${groupOf(got)})${ok ? '' : ` / 기대 ${want}`}`);
}
console.log(fail ? `실패 ${fail}건 / ${CASES.length}` : `모두 통과 ${CASES.length}건`);
process.exit(fail ? 1 : 0);
