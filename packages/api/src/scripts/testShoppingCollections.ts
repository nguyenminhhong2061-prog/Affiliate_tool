import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

async function humanDelay(minMs = 1500, maxMs = 2500): Promise<void> {
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function testShoppingCollections() {
  const shopeeUrl = 'https://vn.shp.ee/5YoD5Mjh';

  console.log('===========================================================');
  console.log(' 🛍️ TEST TÌM MỤC TUYỂN TẬP (COLLECTIONS) TRONG MUA SẮM');
  console.log('===========================================================');
  console.log(`🔗 Link sản phẩm: ${shopeeUrl}\n`);

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--start-maximized',
    ],
  });

  const context = await browser.newContext({
    storageState: SESSION_PATH,
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });");
  const page = await context.newPage();

  try {
    // 1. Mở trang YouTube Studio
    console.log('[1/5] Mở trang YouTube Studio...');
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 45000 });
    await humanDelay(2000, 3000);

    // 2. Vào Kiếm tiền -> Mua sắm
    console.log('[2/5] Mở mục Kiếm tiền -> Mua sắm...');
    const earnMenu = page.locator('a[href*="monetization"]').first();
    if (await earnMenu.isVisible()) {
      await earnMenu.click();
      await humanDelay(2000, 3000);
    }

    const shoppingTab = page.locator('tp-yt-paper-tab:has-text("Mua sắm")').first();
    if (await shoppingTab.isVisible()) {
      await shoppingTab.click();
      await humanDelay(3000, 4000);
    }

    // 3. Cuộn toàn trang Mua sắm xuống dưới để tải hết các mục (Tuyển tập, Cửa hàng, v.v.)
    console.log('[3/5] Đang cuộn trang Mua sắm để quét toàn bộ mục Tuyển tập...');
    await page.evaluate('window.scrollBy(0, 800)');
    await humanDelay(1500, 2500);

    const ssShoppingFull = path.join(SCREENSHOT_DIR, 'collections_1_shopping_scroll.png');
    await page.screenshot({ path: ssShoppingFull, fullPage: true });
    console.log(`📸 Đã chụp ảnh toàn bộ trang Mua sắm: ${ssShoppingFull}`);

    // 4. Tìm mục Tuyển tập (Collections)
    console.log('[4/5] Tìm kiếm chữ "Tuyển tập" hoặc "Bộ sưu tập"...');
    const collectionElements = await page.$$('text="Tuyển tập", text="Bộ sưu tập", text="Collections"');
    console.log(`👉 Tìm thấy ${collectionElements.length} phần tử liên quan đến Tuyển tập!`);

    for (let i = 0; i < collectionElements.length; i++) {
      const isVis = await collectionElements[i].isVisible();
      const text = await collectionElements[i].innerText();
      console.log(`  [Phần tử ${i + 1}] Text: "${text}" | Visible: ${isVis}`);
    }

    // 5. Tìm các nút hoặc thẻ bộ sưu tập cụ thể
    const collectionCards = await page.$$('ytcp-collection-card, [test-id*="collection"], a[href*="collection"]');
    console.log(`👉 Tìm thấy ${collectionCards.length} thẻ bộ sưu tập cụ thể.`);

    console.log('\n===========================================================');
    console.log(' 🎉 HOÀN THÀNH QUÉT TRANG MUA SẮM & TUYỂN TẬP!');
    console.log('===========================================================');
  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
  } finally {
    console.log('⏳ Giữ màn hình mở trong 10 giây để quan sát...');
    await page.waitForTimeout(10000);
    await browser.close();
    process.exit(0);
  }
}

testShoppingCollections();
