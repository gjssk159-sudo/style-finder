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
  // ── 사용자 기준(2026-11-08): 앞이 끝까지 열리면 아우터, 머리부터 입으면 상의, 반집업은 상의 ──
  ['Vintage Dyed Base Hoodie Zip-up (Black)', 'Shop > All > Top', 'hoodie_zipup', '후드 집업은 쇼핑몰이 TOP에 넣어도 아우터'],
  ['MODULAR RUFFLE CARDIGAN / GRAY', 'Tops', 'cardigan', '카디건은 쇼핑몰이 Tops에 넣어도 아우터'],
  ['038 U-NECK KNIT VEST YELLOW', '038 > TOPS', 'vest', '니트 베스트는 아우터(베스트)'],
  ['3BEES ZIP UP HOODED SWEATSHIRT NAVY', '탑', 'hoodie_zipup', '집업 후드 스웨트셔츠는 후드 집업'],
  ['JERSEY ZIP-UP REDUX (BLACK)', 'Shop > All > Top', 'group:outer', '앞이 열리는 저지 집업은 아우터'],
  ['EASY KNITTED HALF ZIP UP (DARK NAVY)', '', 'group:top', '반집업은 상의'],
  ['FUKKURA HALF ZIP-UP HOODIE (BLUE)', '', 'hoodie', '반집업 후드는 후드티(상의)'],
  ['Alter Camo Half Zip-up - Ivory', 'All > Shop > Outer', 'group:top', '쇼핑몰이 Outer에 넣은 반집업도 상의'],
  ['Convertible Half Zip Anorak', '', 'group:outer', '반집업이라도 아노락은 원래 겉옷이라 아우터'],
  ['Half Zip Card Wallet (Sliver)', '홈 > PRODUCTS > Acc', 'group:acc', '반집업 지갑은 소품(옷이 아님)'],
  ['PULLOVER HOODIE BLACK', 'OUTER', 'hoodie', '풀오버라고 적힌 후드는 쇼핑몰이 OUTER에 넣어도 상의'],
  ['BASIC HOODIE BLACK', 'OUTER', 'group:outer', '풀오버·집업 표기 없는 후드를 쇼핑몰이 OUTER에 넣으면 쇼핑몰을 따름'],
  ['SQ LOGO QUARTER ZIP PULLOVER OLIVE', '탑', 'group:top', '쿼터집 풀오버는 상의'],
  ['AV GOOSE DOWN VEST (LOYAL BLUE)', '', 'padding_vest', '다운 베스트는 패딩 베스트'],
  ['Zip-Up Sleeveless Sky Blue', '', 'vest', '앞 지퍼 민소매는 베스트(아우터)'],
  ['LIGHTWEIGHT PULLOVER JACKET', '', 'group:outer', '풀오버라도 재킷은 겉옷이라 아우터'],
  ['24-005 FLEECE PULLOVER (BLACK)', '', 'group:top', '플리스 풀오버는 상의'],
  // ── 지킬 것: 원래 의도한 동작 ──
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
