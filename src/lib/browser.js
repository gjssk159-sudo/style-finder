// 아임웹/식스샵/Cafe24 신테마처럼 상품 데이터가 서버 HTML엔 없고 JS로만 렌더되는 사이트용.
// 브라우저 인스턴스를 하나 띄워서 재사용(사이트/소스 단위로). 페이지 하나 열 때마다
// 새 브라우저를 띄우면 느리니, page 컨텍스트만 새로 만들고 브라우저는 공유한다.

import { chromium } from 'playwright';

let browserPromise = null;

// 브랜드 여러 개를 동시에 돌리면(imweb/sixshop 다 같은 브라우저 공유) 컨텍스트가 한꺼번에
// 너무 많이 떠서 크로미움 자체가 죽는 경우가 있음(실측: "Target crashed" — label-archive
// 수집 중 발생, 그 뒤로 같은 공유 브라우저를 쓰던 다른 요청까지 전부 도미노로 실패했음).
// 죽은 브라우저를 계속 재사용하면 영영 못 살아나므로, disconnected 이벤트가 오면
// 캐시를 비워서 다음 getBrowser() 호출이 새로 띄우게 한다.
async function getBrowser() {
  if (!browserPromise) {
    const launching = chromium.launch({ headless: true });
    browserPromise = launching;
    const browser = await launching;
    browser.on('disconnected', () => {
      // 이 사이 다른 launch가 이미 새로 떠 있으면(드문 레이스) 그건 건드리지 않는다.
      if (browserPromise === launching) browserPromise = null;
    });
    return browser;
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close().catch(() => {});
  }
}

// url을 렌더링해서 완료된 후의 페이지 핸들을 돌려준다. 쓰고 나면 반드시 page.close() 할 것.
export async function renderPage(url, { waitForSelector, timeout = 20000 } = {}) {
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
  } catch (err) {
    // 브라우저가 죽은 직후라 newContext 자체가 실패하는 경우 — 캐시를 비워서
    // 이 호출의 재시도(어댑터 쪽 retry 루프)가 새 브라우저로 다시 시도하게 한다.
    browserPromise = null;
    throw err;
  }
  const page = await context.newPage();
  try {
    // networkidle은 채널톡 같은 상시 연결(웹소켓/폴링) 위젯 때문에 영영 안 끝나는 경우가 많음.
    // load도 마찬가지로 무거운 트래킹 스크립트(채널톡, 광고 픽셀 등)가 많은 사이트에서
    // 20초 안에 안 끝나는 경우가 있었음(실측: bluesf.kr — 요청 490개 이상, 매번 타임아웃).
    // domcontentloaded면 그런 부가 스크립트를 안 기다리고도 실제 상품 DOM은 이미 잡을 수 있고,
    // 그 다음 SPA 하이드레이션 시간(waitForSelector/waitForTimeout)은 어차피 별도로 준다.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {});
    } else {
      await page.waitForTimeout(2000);
    }
    return { page, context };
  } catch (err) {
    await context.close();
    throw err;
  }
}
