import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

async function testRealTagging() {
  const shopeeUrl = 'https://vn.shp.ee/5YoD5Mjh';

  console.log('===========================================================');
  console.log(' 🚀 TIẾN HÀNH TEST THẬT TRÊN YOUTUBE STUDIO & LINK SHOPEE');
  console.log('===========================================================');
  console.log(`🔗 Link sản phẩm: ${shopeeUrl}`);
  console.log(`🔑 File session: ${SESSION_PATH}\n`);

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // 1. Khởi chạy trình duyệt Chrome với session đã lưu
  console.log('[1/4] Đang khởi chạy Chrome với session đăng nhập thật...');
  const browser = await chromium.launch({
    headless: false, // Bật giao diện để bạn và hệ thống cùng quan sát trực tiếp
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
    // 2. Truy cập YouTube Studio
    console.log('[2/4] Đang mở trang YouTube Studio...');
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 45000 });
    
    // Đợi 3 giây để trang load đầy đủ
    await page.waitForTimeout(3000);
    const ss1 = path.join(SCREENSHOT_DIR, 'real_test_1_studio_home.png');
    await page.screenshot({ path: ss1, fullPage: true });
    console.log(`📸 Đã chụp màn hình trang chủ Studio: ${ss1}`);

    // 3. Tìm mục Kiếm tiền / Shopping hoặc nút Gắn sản phẩm
    console.log('[3/4] Đang kiểm tra giao diện Shopping / Kiếm tiền trên kênh...');
    
    // Tìm các selector phổ biến của YouTube Shopping / Earn tab
    const earnSelectors = [
      'a[test-id="monetization"]',
      '#menu-item-link-monetization',
      'tp-yt-paper-item:has-text("Earn")',
      'tp-yt-paper-item:has-text("Kiếm tiền")',
      'tp-yt-paper-item:has-text("Shopping")',
      'a[href*="monetization"]',
    ];

    let foundEarnTab = false;
    for (const selector of earnSelectors) {
      if (await page.$(selector)) {
        console.log(`👉 Đã tìm thấy menu: ${selector}`);
        await page.click(selector);
        foundEarnTab = true;
        await page.waitForTimeout(3000);
        break;
      }
    }
    if (!foundEarnTab) console.log('ℹ️ Không thấy selector menu Earn mặc định, đang ở trang hiện tại.');

    // 4. Bấm vào tab "Mua sắm" trong trang Kiếm tiền
    console.log('[4/5] Đang mở tab "Mua sắm" (Shopping)...');
    const shoppingTabSelectors = [
      'tp-yt-paper-tab:has-text("Mua sắm")',
      'div[role="tab"]:has-text("Mua sắm")',
      'tp-yt-paper-tab:has-text("Shopping")',
      'div[role="tab"]:has-text("Shopping")',
      'div:has-text("Mua sắm"):visible',
    ];

    let foundShoppingTab = false;
    for (const tabSel of shoppingTabSelectors) {
      const el = await page.$(tabSel);
      if (el && await el.isVisible()) {
        console.log(`👉 Đã tìm thấy tab Mua sắm: ${tabSel}`);
        await el.click();
        foundShoppingTab = true;
        await page.waitForTimeout(4000);
        break;
      }
    }
    if (!foundShoppingTab) console.log('ℹ️ Chưa bấm được tab Mua sắm.');

    const ss2 = path.join(SCREENSHOT_DIR, 'real_test_2_shopping_tab.png');
    await page.screenshot({ path: ss2, fullPage: true });
    console.log(`📸 Đã chụp màn hình mục Mua sắm: ${ss2}`);

    // 5. Tìm ô tìm kiếm sản phẩm hoặc nút gắn sản phẩm trong tab Mua sắm
    console.log('[5/5] Đang tìm kiếm công cụ thêm sản phẩm trong tab Mua sắm...');
    const productTaggingSelectors = [
      'button:has-text("Gắn thẻ sản phẩm")',
      'button:has-text("Tag products")',
      'button:has-text("Thêm sản phẩm")',
      'button:has-text("Add products")',
      'input[placeholder*="Tìm kiếm sản phẩm"]',
      'input[placeholder*="Search products"]',
    ];

    let foundProductTool = false;
    for (const toolSel of productTaggingSelectors) {
      const el = await page.$(toolSel);
      if (el && await el.isVisible()) {
        console.log(`👉 Tìm thấy công cụ gắn sản phẩm: ${toolSel}`);
        await el.click();
        foundProductTool = true;
        await page.waitForTimeout(3000);
        break;
      }
    }
    if (!foundProductTool) console.log('ℹ️ Kiểm tra toàn bộ các nút trên trang Mua sắm.');

    const ss3 = path.join(SCREENSHOT_DIR, 'real_test_3_product_result.png');
    await page.screenshot({ path: ss3, fullPage: true });
    console.log(`📸 Đã chụp màn hình kết quả: ${ss3}`);

    console.log('\n===========================================================');
    console.log(' 🎉 HOÀN TẤT BƯỚC TEST THỰC TẾ TRÊN GIAO DIỆN!');
    console.log('===========================================================');

  } catch (err: any) {
    console.error('❌ Lỗi trong quá trình chạy test thật:', err.message);
    const ssErr = path.join(SCREENSHOT_DIR, 'real_test_error.png');
    await page.screenshot({ path: ssErr, fullPage: true });
    console.log(`📸 Đã chụp ảnh màn hình lỗi tại: ${ssErr}`);
  } finally {
    console.log('\n⏳ Giữ trình duyệt mở trong 10 giây để bạn quan sát kết quả...');
    await page.waitForTimeout(10000);
    await browser.close();
    process.exit(0);
  }
}

testRealTagging();
