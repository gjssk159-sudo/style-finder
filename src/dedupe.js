// 상품명 정규화 + 그룹핑 + 색상 추출
// 목적: 같은 상품의 색상별 분리 등록(쇼피파이/카페24 둘 다 흔함)을 한 상품으로 묶고,
//       제목에 섞여 있던 색상을 검색·필터 가능한 구조화 필드로 분리.
//   "IN MY PANTS (LAVENDER)" / "IN MY PANTS (SQUARED KHAKI)"  ->  title_norm "IN MY PANTS", color lavender/khaki
//   "[리오더] EVERYDAY LOGO HALF TEE (OFF WHITE)"             ->  "EVERYDAY LOGO HALF TEE", color white
// 브랜드는 resolveBrand()로 표준화해서 묶음(같은 브랜드가 소스마다 다른 표기여도 하나로 합쳐짐).
// 완전히 다른 소스에 같은 상품이 이미지만 다르게 올라간 경우(브랜드명 자체가 다르게 잡힌 경우)는
// 아직 처리 안 함 -> 나중에 이미지 해시 매칭으로 보강.

import { resolveBrand } from './lib/brand-alias.js';

// 표면형(한/영, 동의어) -> 표준 색상 id. 필터는 항상 이 id 기준으로 동작.
export const COLOR_MAP = {
  블랙: 'black', black: 'black',
  화이트: 'white', white: 'white',
  아이보리: 'ivory', ivory: 'ivory',
  크림: 'cream', cream: 'cream',
  베이지: 'beige', beige: 'beige', ecru: 'beige',
  카키: 'khaki', khaki: 'khaki',
  네이비: 'navy', navy: 'navy',
  블루: 'blue', blue: 'blue',
  스카이: 'sky', sky: 'sky',
  그린: 'green', green: 'green',
  올리브: 'olive', olive: 'olive',
  그레이: 'grey', 그레이지: 'grey', grey: 'grey', gray: 'grey', greige: 'grey',
  차콜: 'charcoal', charcoal: 'charcoal',
  브라운: 'brown', brown: 'brown', 초콜릿: 'brown', chocolate: 'brown',
  탄: 'tan', tan: 'tan', 카멜: 'camel', camel: 'camel',
  퍼플: 'purple', purple: 'purple', 라벤더: 'lavender', lavender: 'lavender',
  핑크: 'pink', pink: 'pink',
  레드: 'red', red: 'red', 와인: 'wine', wine: 'wine', 버건디: 'burgundy', burgundy: 'burgundy',
  오렌지: 'orange', orange: 'orange',
  옐로우: 'yellow', 옐로: 'yellow', yellow: 'yellow',
  샌드: 'sand', sand: 'sand',
  민트: 'mint', mint: 'mint',
  멜란지: 'melange', melange: 'melange',
  데님: 'denim', denim: 'denim', 인디고: 'indigo', indigo: 'indigo', 워시드: 'washed', washed: 'washed',
  silver: 'silver', gold: 'gold', multi: 'multi',
};
// 화면 표시용 (표준 id -> 한글 라벨)
export const COLOR_LABELS = {
  black: '블랙', white: '화이트', ivory: '아이보리', cream: '크림', beige: '베이지', khaki: '카키',
  navy: '네이비', blue: '블루', sky: '스카이', green: '그린', olive: '올리브', grey: '그레이',
  charcoal: '차콜', brown: '브라운', tan: '탄', camel: '카멜', purple: '퍼플', lavender: '라벤더',
  pink: '핑크', red: '레드', wine: '와인', burgundy: '버건디', orange: '오렌지', yellow: '옐로우',
  sand: '샌드', mint: '민트', melange: '멜란지', denim: '데님', indigo: '인디고', washed: '워시드',
  silver: '실버', gold: '골드', multi: '멀티',
};

const COLOR_WORDS = Object.keys(COLOR_MAP);
const COLOR_FIND_RE = new RegExp(`(^|[\\s/_(),-])(${COLOR_WORDS.join('|')})(?=[\\s/_(),-]|$)`, 'gi');

export function extractColors(raw) {
  const s = String(raw || '');
  const ids = new Set();
  for (const m of s.matchAll(COLOR_FIND_RE)) ids.add(COLOR_MAP[m[2].toLowerCase()]);
  return [...ids];
}

export function normalizeTitle(raw) {
  let s = String(raw || '');

  // 앞쪽 대괄호 태그: [리오더], [예약], [재입고], [단독] ...
  s = s.replace(/^\s*(\[[^\]]*\]\s*)+/g, ' ');
  // 괄호/대괄호 안 내용 제거 (보통 색상/사이즈/부가설명)
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  // 뒤쪽 " - COLOR" 또는 " / COLOR" 형태 색상 반복 제거
  let prev;
  do {
    prev = s;
    s = s.replace(COLOR_FIND_RE, '$1');
  } while (s !== prev);

  s = s
    .replace(/\s*[-/|]\s*$/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  return s;
}

// items: run.js가 뽑은 공통 형식 배열 (여러 소스 합쳐도 됨)
// 반환: [{ brand, title_norm, title, categories, colors, sizes, min_price, max_price, image, in_stock, offers:[...] }]
export function groupItems(items) {
  const groups = new Map();

  // 같은 쇼핑몰이 같은 상품을 색상/핏별로 따로 올려둔 경우("Chino Pants - Navy(1)", "(2)", "Khaki Beige(1)"...)
  // 예전엔 전부 한 카드로 합쳤는데, 카드 링크는 첫 번째 것만 가리켜서 나머지는 앱에서 접근할 방법이 없었다
  // (실측: 전체 20,748개 중 12,452개 카드만 보임 — 쇼핑몰에 있는 상품이 "덜 등록"된 것처럼 보임).
  // 그래서 같은 소스 안에서는 합치지 않고 상품 하나당 카드 하나로 두고, 서로 다른 소스(편집샵 vs 브랜드 공식몰)에
  // 같은 상품이 있을 때만 합친다. 합치는 쪽을 결정적으로 만들기 위해 (소스, 외부id) 순으로 정렬해서 처리.
  const ordered = [...items].sort(
    (a, b) =>
      String(a.source_id).localeCompare(String(b.source_id)) ||
      String(a.external_id).localeCompare(String(b.external_id), undefined, { numeric: true }),
  );

  for (const it of ordered) {
    const rawBrand = (it.brand || it.source_id || 'UNKNOWN').trim();
    const { key: brandKey, display: brand, id: resolvedId } = resolveBrand(rawBrand);
    // 편집샵에서만 파는, 자체 등록 안 된 브랜드는 resolveBrand가 id를 못 찾음 ->
    // 그대로 버리면 검색에서 사라지므로 수집한 소스(편집샵) id로 대신 걸어서 그 폴더에서라도 보이게 함.
    const brandId = resolvedId || it.source_id || null;
    let norm = normalizeTitle(it.title) || normalizeTitle(it.external_id);
    let key = brandKey + ' || ' + norm;
    // 이미 같은 소스의 상품이 이 그룹에 있으면 별도 카드로 (title_norm 뒤에 외부id를 붙여 유일하게).
    if (groups.get(key)?.offers.some((o) => o.source_id === it.source_id)) {
      norm = `${norm} #${it.external_id}`;
      key = brandKey + ' || ' + norm;
    }
    const colors = extractColors(it.title);

    if (!groups.has(key)) {
      groups.set(key, {
        brand,
        brand_id: brandId,
        title_norm: norm,
        title: it.title,
        categories: new Set(),
        colors: new Set(),
        sizes: new Set(),
        prices: [],
        image: null,
        in_stock: false,
        gender: null,
        offers: [],
      });
    }
    const g = groups.get(key);

    // 대표 title: 더 짧은(=군더더기 적은) 쪽
    if (it.title && it.title.length < g.title.length) g.title = it.title;
    if (!g.gender && it.gender) g.gender = it.gender;
    for (const c of it.categories || []) g.categories.add(c);
    for (const c of colors) g.colors.add(c);
    for (const sz of it.sizes || []) g.sizes.add(sz);
    if (typeof it.price === 'number' && it.price > 0) g.prices.push(it.price);
    if (!g.image && it.images?.length) g.image = it.images[0];
    if (it.in_stock) g.in_stock = true;

    g.offers.push({
      source_id: it.source_id,
      source_type: it.source_type,
      external_id: String(it.external_id),
      url: it.url,
      title: it.title,
      price: typeof it.price === 'number' ? it.price : null,
      image: it.images?.[0] || null,
      in_stock: !!it.in_stock,
      colors,
      sizes: it.sizes || [],
    });
  }

  return [...groups.values()].map((g) => ({
    brand: g.brand,
    brand_id: g.brand_id,
    title_norm: g.title_norm,
    title: g.title,
    categories: [...g.categories],
    colors: [...g.colors],
    sizes: [...g.sizes],
    min_price: g.prices.length ? Math.min(...g.prices) : null,
    max_price: g.prices.length ? Math.max(...g.prices) : null,
    image: g.image,
    in_stock: g.in_stock,
    gender: g.gender,
    offers: g.offers,
  }));
}
