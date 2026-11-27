// #21 쇼핑몰인지 가려내는 기준(등록 함수와 시험이 같이 쓴다)
// 첫 화면에서 쇼핑몰 흔적 개수 세기(0~4): 상품 링크, 가격 표시, 장바구니·구매, 상품(Product) 구조 정보
export function shopSignals(html: string): number {
  const h = html.slice(0, 600000);
  let n = 0;
  if (/href=["'][^"']*\/(product|products|goods|item|items|shop)\/[^"']+/i.test(h) || /product_no=\d+|goodsNo=\d+|idx=\d+/i.test(h)) n++;
  if (/(₩|￦)\s?\d|\d[\d,]{2,}\s?(원|KRW)|"price"\s*:|itemprop=["']price/i.test(h)) n++;
  if (/장바구니|구매하기|바로\s?구매|add[\s-]?to[\s-]?cart|\bcart\b|checkout/i.test(h)) n++;
  if (/"@type"\s*:\s*"(Product|Offer)"|og:type["'][^>]*product/i.test(h)) n++;
  return n;
}

// 첫 화면이 "빈 껍데기"인 쇼핑몰(자체 제작 앱: 글자는 거의 없고 화면을 그리는 스크립트만 있음)은
// 쇼핑몰 흔적을 셀 수 없으므로 "쇼핑몰 아님"으로 거절하지 않는다(사람이 확인하는 대기열로).
// 예: thisisneverthat.com — 첫 HTML 2KB, <script type="module"> 하나, 상품은 나중에 그려짐.
export function isAppShell(html: string): boolean {
  const h = html.slice(0, 200000);
  const body = (h.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, h])[1] || '';
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const hasApp = /<script[^>]+(type=["']module["']|src=["'][^"']*(index|main|app|bundle|chunk)[^"']*\.js)/i.test(h) || /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(h);
  return hasApp && text.length < 200;
}
