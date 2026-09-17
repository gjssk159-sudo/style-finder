// 아임웹/식스샵/Cafe24 신테마처럼 상품 데이터가 서버 HTML엔 없고 JS로만 렌더되는 사이트용.
// 브라우저 인스턴스를 하나 띄워서 재사용(사이트/소스 단위로). 페이지 하나 열 때마다
// 새 브라우저를 띄우면 느리니, page 컨텍스트만 새로 만들고 브라우저는 공유한다.

import { chromium } from 'playwright';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

// url을 렌더링해서 완료된 후의 페이지 핸들을 돌려준다. 쓰고 나면 반드시 page.close() 할 것.
export async function renderPage(url, { waitForSelector, timeout = 20000 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    // networkidle은 채널톡 같은 상시 연결(웹소켓/폴링) 위젯 때문에 영영 안 끝나는 경우가 많음.
    // load만 기다리고, 그 다음 SPA 하이드레이션 시간을 별도로 준다.
    await page.goto(url, { waitUntil: 'load', timeout });
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
