import { chromium, devices } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

async function inspectMobileSplash() {
  console.log('===========================================================');
  console.log(' 📱 INSPECT GIAO DIỆN MOBILE YOUTUBE STUDIO & TUYỂN TẬP');
  console.log('===========================================================');

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const mobileDevice = devices['Pixel 7'] || {
    viewport: { width: 393, height: 851 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    isMobile: true,
    hasTouch: true,
  };

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
    console.log('[1/4] Đang mở studio.youtube.com...');
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Chụp lại màn hình ban đầu
    const ssInit = path.join(SCREENSHOT_DIR, 'mobile_splash_init.png');
    await page.screenshot({ path: ssInit });
    console.log(`📸 Màn hình ban đầu: ${ssInit}`);

    // Click vào "TIẾP TỤC CHUYỂN ĐẾN STUDIO"
    const continueBtn = page.getByText(/TIẾP TỤC CHUYỂN ĐẾN STUDIO|Tiếp tục chuyển đến Studio|Continue to Studio/i);
    if (await continueBtn.isVisible()) {
      console.log('👉 Đã thấy nút "TIẾP TỤC CHUYỂN ĐẾN STUDIO", đang bấm...');
      await continueBtn.click();
      await page.waitForTimeout(5000);
    } else {
      console.log('ℹ️ Không thấy nút splash, thử click link cuối trang');
      const allLinks = await page.$$('a');
      for (const link of allLinks) {
        const txt = await link.innerText();
        if (txt.includes('STUDIO') || txt.includes('Studio')) {
          console.log(`👉 Bấm vào link: "${txt}"`);
          await link.click();
          await page.waitForTimeout(5000);
          break;
        }
      }
    }

    // Chụp lại màn hình sau khi bấm
    const ssAfter = path.join(SCREENSHOT_DIR, 'mobile_dashboard_after_splash.png');
    await page.screenshot({ path: ssAfter, fullPage: true });
    console.log(`📸 Màn hình sau khi chuyển vào Studio: ${ssAfter}`);

    // In ra URL hiện tại
    console.log(`🌐 URL hiện tại: ${page.url()}`);

    // Quét toàn bộ menu và các mục có chữ "Kiếm tiền", "Mua sắm", "Tuyển tập", "Bộ sưu tập"
    const pageText = await page.innerText('body');
    console.log('\n--- CÁC TỪ KHÓA TÌM THẤY TRÊN GIAO DIỆN MOBILE ---');
    console.log('Có chữ "Kiếm tiền":', pageText.includes('Kiếm tiền'));
    console.log('Có chữ "Mua sắm":', pageText.includes('Mua sắm'));
    console.log('Có chữ "Tuyển tập":', pageText.includes('Tuyển tập'));
    console.log('Có chữ "Bộ sưu tập":', pageText.includes('Bộ sưu tập'));

    // Chụp ảnh cuộn trang
    await page.evaluate('window.scrollBy(0, 600)');
    await page.waitForTimeout(2000);
    const ssScroll = path.join(SCREENSHOT_DIR, 'mobile_dashboard_scroll.png');
    await page.screenshot({ path: ssScroll, fullPage: true });
    console.log(`📸 Màn hình cuộn: ${ssScroll}`);

  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
  } finally {
    console.log('\n⏳ Giữ màn hình mở trong 12 giây...');
    await page.waitForTimeout(12000);
    await browser.close();
    process.exit(0);
  }
}

inspectMobileSplash();
