import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

async function testTagVideo() {
  const shopeeUrl = 'https://vn.shp.ee/5YoD5Mjh';

  console.log('===========================================================');
  console.log(' 🎬 TEST GẮN THẺ SẢN PHẨM SHOPEE VÀO VIDEO/SHORTS TRÊN YOUTUBE');
  console.log('===========================================================');
  console.log(`🔗 Link sản phẩm Shopee: ${shopeeUrl}\n`);

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
    // 1. Mở trang Nội dung (Content / Videos)
    console.log('[1/5] Đang mở trang Nội dung video...');
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);

    const contentMenuSelectors = [
      'tp-yt-paper-item:has-text("Nội dung")',
      '#menu-item-link-content',
      'a[test-id="content"]',
      'a[href*="videos"]',
    ];

    for (const sel of contentMenuSelectors) {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        console.log(`👉 Bấm vào menu Nội dung: ${sel}`);
        await el.click();
        await page.waitForTimeout(3000);
        break;
      }
    }

    // 1.1 Chuyển sang tab Shorts
    console.log('[1.1] Đang chuyển sang tab Shorts...');
    const shortsTabSelectors = [
      'tp-yt-paper-tab:has-text("Shorts")',
      'div[role="tab"]:has-text("Shorts")',
      'div:has-text("Shorts"):visible',
    ];
    for (const sSel of shortsTabSelectors) {
      const el = await page.$(sSel);
      if (el && await el.isVisible()) {
        console.log(`👉 Bấm vào tab Shorts: ${sSel}`);
        await el.click();
        await page.waitForTimeout(3000);
        break;
      }
    }

    const ssContent = path.join(SCREENSHOT_DIR, 'tag_1_content_list.png');
    await page.screenshot({ path: ssContent, fullPage: true });
    console.log(`📸 Đã chụp màn hình danh sách Shorts: ${ssContent}`);

    // 2. Chọn video/shorts đầu tiên để mở chi tiết
    console.log('[2/5] Đang chọn video đầu tiên trong danh sách...');
    const firstVideoSelectors = [
      '#video-title',
      'a[id="video-title"]',
      'ytcp-video-list-cell-video a',
      '.style-scope.ytcp-video-list-cell-video',
    ];

    let clickedVideo = false;
    for (const vSel of firstVideoSelectors) {
      const el = await page.$(vSel);
      if (el && await el.isVisible()) {
        console.log(`👉 Bấm vào video: ${vSel}`);
        await el.click();
        clickedVideo = true;
        await page.waitForTimeout(4000);
        break;
      }
    }
    if (!clickedVideo) console.log('ℹ️ Thử click trực tiếp vào hàng video đầu tiên.');

    const ssDetail = path.join(SCREENSHOT_DIR, 'tag_2_video_details.png');
    await page.screenshot({ path: ssDetail, fullPage: true });
    console.log(`📸 Đã chụp màn hình chi tiết video: ${ssDetail}`);

    // 3. Click chính xác vào nút [ 👜 Sản phẩm ]
    console.log('[3/5] Đang bấm vào nút [ 👜 Sản phẩm ]...');
    const productButton = page.locator('button, tp-yt-paper-button, ytcp-chip').filter({ hasText: 'Sản phẩm' }).first();
    
    if (await productButton.isVisible()) {
      console.log('👉 Đã tìm thấy nút [ Sản phẩm ], đang click...');
      await productButton.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('ℹ️ Thử click bằng selector text');
      await page.click('text="Sản phẩm"');
      await page.waitForTimeout(3000);
    }

    const ssTagModal = path.join(SCREENSHOT_DIR, 'tag_3_tag_modal.png');
    await page.screenshot({ path: ssTagModal, fullPage: true });
    console.log(`📸 Đã chụp màn hình sau khi bấm Sản phẩm: ${ssTagModal}`);

    // 4. Tìm ô tìm kiếm sản phẩm trong dialog vừa mở
    console.log('[4/5] Đang tìm ô dán link Shopee trong modal...');
    const dialogSearch = page.locator('ytcp-dialog input, ytcp-navigation-dialog input, input[type="text"]').first();
    if (await dialogSearch.isVisible()) {
      console.log('👉 Đã tìm thấy ô tìm kiếm trong dialog, đang dán link Shopee...');
      await dialogSearch.fill(shopeeUrl);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);
    } else {
      console.log('ℹ️ Không thấy ô input trong dialog.');
    }

    const ssResult = path.join(SCREENSHOT_DIR, 'tag_4_search_result.png');
    await page.screenshot({ path: ssResult, fullPage: true });
    console.log(`📸 Đã chụp màn hình kết quả: ${ssResult}`);

    console.log('\n===========================================================');
    console.log(' 🎉 HOÀN TẤT KIỂM TRA QUY TRÌNH GẮN SẢN PHẨM TRỰC TIẾP!');
    console.log('===========================================================');
  } catch (err: any) {
    console.error('❌ Lỗi:', err.message);
  } finally {
    console.log('⏳ Giữ trình duyệt 10 giây để quan sát...');
    await page.waitForTimeout(10000);
    await browser.close();
    process.exit(0);
  }
}

testTagVideo();
