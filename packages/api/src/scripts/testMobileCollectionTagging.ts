import { chromium, devices } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

async function humanDelay(minMs = 1500, maxMs = 2500): Promise<void> {
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function testMobileCollectionTagging() {
  const shopeeUrl = 'https://vn.shp.ee/5YoD5Mjh';

  console.log('========================================================================');
  console.log(' 📱 TEST QUY TRÌNH GẮN SẢN PHẨM QUA TUYỂN TẬP / SHOPPING (GIẢ LẬP MOBILE)');
  console.log('========================================================================');
  console.log(`🔗 Link sản phẩm: ${shopeeUrl}`);
  console.log(`🔑 File session: ${SESSION_PATH}\n`);

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // 1. Cấu hình Giả lập Mobile (Pixel 7 / iPhone)
  const mobileDevice = devices['Pixel 7'] || {
    viewport: { width: 393, height: 851 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    isMobile: true,
    hasTouch: true,
  };

  console.log('[1/7] Khởi chạy Chrome với chế độ giả lập Mobile Phone...');
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
    ...mobileDevice,
    storageState: SESSION_PATH,
  });

  await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });");
  const page = await context.newPage();

  try {
    // 2. Vào YouTube Studio
    console.log('[2/7] Đang mở trang YouTube Studio Mobile...');
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 45000 });
    await humanDelay(2000, 3000);

    // Kiểm tra nếu có màn hình "Hãy dùng thử ứng dụng YouTube Studio" -> Bấm "TIẾP TỤC CHUYỂN ĐẾN STUDIO"
    const continueToStudio = page.locator('text="TIẾP TỤC CHUYỂN ĐẾN STUDIO", text="Tiếp tục chuyển đến Studio", text="CONTINUE TO STUDIO"').first();
    if (await continueToStudio.isVisible()) {
      console.log('👉 Phát hiện màn hình app splash -> Đang bấm [ TIẾP TỤC CHUYỂN ĐẾN STUDIO ]...');
      await continueToStudio.click();
      await humanDelay(3000, 4500);
    }

    const ss1 = path.join(SCREENSHOT_DIR, 'mobile_1_home.png');
    await page.screenshot({ path: ss1 });
    console.log(`📸 Đã chụp màn hình trang chủ: ${ss1}`);

    // 3. Vào Kiếm tiền -> Mua sắm (Shopping)
    console.log('[3/7] Đang điều hướng tới mục Kiếm tiền -> Mua sắm...');
    
    // Thử truy cập trực tiếp URL Shopping của Studio
    const currentUrl = page.url();
    const channelIdMatch = currentUrl.match(/channel\/([^/]+)/);
    if (channelIdMatch) {
      const channelId = channelIdMatch[1];
      const shoppingUrl = `https://studio.youtube.com/channel/${channelId}/monetization/shopping`;
      console.log(`👉 Mở link trực tiếp: ${shoppingUrl}`);
      await page.goto(shoppingUrl, { waitUntil: 'networkidle', timeout: 30000 });
    } else {
      // Bấm qua menu
      const earnMenu = page.locator('a[href*="monetization"], tp-yt-paper-item:has-text("Kiếm tiền"), tp-yt-paper-item:has-text("Earn")').first();
      if (await earnMenu.isVisible()) {
        await earnMenu.click();
        await humanDelay(2000, 3000);
      }
      const shoppingTab = page.locator('tp-yt-paper-tab:has-text("Mua sắm"), div[role="tab"]:has-text("Mua sắm")').first();
      if (await shoppingTab.isVisible()) {
        await shoppingTab.click();
        await humanDelay(2000, 3000);
      }
    }

    const ss2 = path.join(SCREENSHOT_DIR, 'mobile_2_shopping.png');
    await page.screenshot({ path: ss2 });
    console.log(`📸 Đã chụp màn hình trang Mua sắm: ${ss2}`);

    // 4. Tìm mục Tuyển tập (Collections) và chọn 1 bộ sưu tập bất kỳ
    console.log('[4/7] Đang tìm kiếm mục Tuyển tập (Collections)...');
    const collectionSelectors = [
      'div:has-text("Tuyển tập")',
      'div:has-text("Bộ sưu tập")',
      'ytcp-collection-card',
      'a[href*="collection"]',
      'div[role="listitem"]',
    ];

    let foundCollection = false;
    for (const sel of collectionSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible()) {
        console.log(`👉 Tìm thấy mục/bộ sưu tập: ${sel}`);
        await el.click();
        foundCollection = true;
        await humanDelay(2000, 3000);
        break;
      }
    }
    if (!foundCollection) console.log('ℹ️ Đang quét tiếp các phần tử trên trang Mua sắm.');

    const ss3 = path.join(SCREENSHOT_DIR, 'mobile_3_collection_detail.png');
    await page.screenshot({ path: ss3 });
    console.log(`📸 Đã chụp màn hình chi tiết bộ sưu tập: ${ss3}`);

    // 5. Thêm sản phẩm -> Dán link Shopee -> Chọn Người bán Shopee -> Chọn SP -> Xong -> Đăng
    console.log('[5/7] Đang thực hiện gắn link Shopee vào bộ sưu tập...');
    const addProductBtn = page.locator('button, tp-yt-paper-button').filter({ hasText: 'Thêm sản phẩm' }).first();
    if (await addProductBtn.isVisible()) {
      console.log('👉 Bấm nút [ Thêm sản phẩm ]');
      await addProductBtn.click();
      await humanDelay(1500, 2500);

      // Ô dán link
      const searchInput = page.locator('input[placeholder*="Tìm kiếm"], input[placeholder*="Dán"], input[type="text"]').first();
      if (await searchInput.isVisible()) {
        console.log(`👉 Dán link Shopee: ${shopeeUrl}`);
        await searchInput.fill(shopeeUrl);
        await page.keyboard.press('Enter');
        await humanDelay(2000, 3500);
      }

      // Chọn người bán Shopee nếu có
      const sellerShopee = page.locator('text="Shopee"').first();
      if (await sellerShopee.isVisible()) {
        console.log('👉 Nhấn chọn người bán Shopee');
        await sellerShopee.click();
        await humanDelay(1500, 2500);
      }

      // Chọn sản phẩm hiện ra
      const productCheckbox = page.locator('input[type="checkbox"], [role="checkbox"], ytcp-checkbox').first();
      if (await productCheckbox.isVisible()) {
        console.log('👉 Tick chọn sản phẩm');
        await productCheckbox.click();
        await humanDelay(1000, 2000);
      }

      // Bấm nút Xong
      const doneBtn = page.locator('button:has-text("Xong"), button:has-text("Done")').first();
      if (await doneBtn.isVisible()) {
        console.log('👉 Bấm nút [ Xong ]');
        await doneBtn.click();
        await humanDelay(2000, 3000);
      }

      // Bấm nút Đăng
      const publishBtn = page.locator('button:has-text("Đăng"), button:has-text("Publish")').first();
      if (await publishBtn.isVisible()) {
        console.log('👉 Bấm nút [ Đăng ]');
        await publishBtn.click();
        await humanDelay(2500, 4000);
      }
    }

    const ss4 = path.join(SCREENSHOT_DIR, 'mobile_4_publish_result.png');
    await page.screenshot({ path: ss4 });
    console.log(`📸 Đã chụp màn hình sau khi Đăng: ${ss4}`);

    // 6. Giai đoạn 2: Lấy link chia sẻ bộ sưu tập và trích xuất link Affiliate sản phẩm
    console.log('[6/7] Đang lấy link chia sẻ của Bộ sưu tập...');
    const moreMenuBtn = page.locator('button[aria-label*="Tác vụ"], button[aria-label*="Action"], ytcp-icon-button:has-text("more_vert")').first();
    if (await moreMenuBtn.isVisible()) {
      await moreMenuBtn.click();
      await humanDelay(1000, 2000);
      
      const shareBtn = page.locator('text="Chia sẻ", text="Share"').first();
      if (await shareBtn.isVisible()) {
        await shareBtn.click();
        await humanDelay(1000, 2000);
      }
    }

    console.log('[7/7] Hoàn thành các bước!');
  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
    const ssErr = path.join(SCREENSHOT_DIR, 'mobile_error.png');
    await page.screenshot({ path: ssErr });
    console.log(`📸 Đã chụp ảnh màn hình lỗi: ${ssErr}`);
  } finally {
    console.log('⏳ Giữ màn hình mở trong 12 giây để quan sát...');
    await page.waitForTimeout(12000);
    await browser.close();
    process.exit(0);
  }
}

testMobileCollectionTagging();
