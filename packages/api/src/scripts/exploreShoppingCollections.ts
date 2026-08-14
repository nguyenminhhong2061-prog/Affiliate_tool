import { chromium, devices, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');
const CHANNEL_ID = 'UC3fFeHphb3dQtKcr0RdAOmA';

async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function snap(page: Page, name: string) {
  const p = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`📸 ${name}`);
  return p;
}

async function bypassSplash(page: Page) {
  const btn = page.getByText(/TIẾP TỤC CHUYỂN ĐẾN STUDIO|Tiếp tục chuyển đến Studio/i);
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
    console.log('  → Bypass splash...');
    await btn.click();
    await delay(3500);
  }
}

async function main() {
  console.log('=======================================================');
  console.log(' 📱 CLICK TAB MUA SẮM → TÌM TUYỂN TẬP');
  console.log('=======================================================');

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    ...mobileDevice,
    storageState: SESSION_PATH,
  });
  await context.addInitScript(
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
  );
  const page = await context.newPage();

  try {
    // STEP 1: Vào trang Kiếm tiền / Monetization (Tổng quan)
    console.log('\n[STEP 1] Vào trang Kiếm tiền...');
    await page.goto(
      `https://studio.youtube.com/channel/${CHANNEL_ID}/monetization/overview?approve_browser_access=true`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await delay(3500);
    await bypassSplash(page);
    await snap(page, 'tab_step1_monetization.png');
    console.log(`  URL: ${page.url()}`);

    // STEP 2: Tìm và click tab "Mua sắm" (bị ẩn, cần scroll tabs)
    console.log('\n[STEP 2] Tìm và click tab MUA SẮM...');

    // Thử click mũi tên > để hiển thị thêm tabs
    const tabArrow = page.locator('tp-yt-paper-tabs .forward-btn, [class*="forward"], ytcp-tab-bar button[aria-label*="next"], iron-icon[icon="chevron-right"]').first();
    if (await tabArrow.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  → Click mũi tên > để hiện tabs ẩn...');
      await tabArrow.click();
      await delay(1000);
    }

    // Click tab Mua sắm
    const shoppingTab = page.locator('tp-yt-paper-tab').filter({ hasText: 'Mua sắm' }).first();
    if (await shoppingTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  → Click tab "Mua sắm"...');
      await shoppingTab.click();
      await delay(3000);
    } else {
      console.log('  → Không tìm thấy tab, thử navigate trực tiếp...');
      await page.goto(
        `https://studio.youtube.com/channel/${CHANNEL_ID}/monetization/shopping?approve_browser_access=true`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );
      await delay(3000);
      await bypassSplash(page);
    }

    await snap(page, 'tab_step2_after_shopping_tab.png');
    console.log(`  URL: ${page.url()}`);

    // STEP 3: Đọc nội dung trang Shopping
    console.log('\n[STEP 3] Nội dung trang Mua sắm...');
    const bodyText = await page.innerText('body');
    const lines = bodyText.split('\n').filter((l) => l.trim().length > 2);
    console.log('  Toàn bộ nội dung (dòng đáng chú ý):');
    lines.forEach((l) => console.log(`    | ${l.trim()}`));

    // Kiểm tra keywords
    const kws = ['Tuyển tập', 'Bộ sưu tập', 'Collection', 'Thêm sản phẩm', 'Chia sẻ', 'Quản lý', 'Trung tâm', 'Liên kết', 'affiliate_hub'];
    for (const kw of kws) {
      console.log(`  "${kw}": ${bodyText.includes(kw)}`);
    }

    // STEP 4: Tìm tất cả các links và buttons trên trang
    console.log('\n[STEP 4] Links & Buttons trên trang...');
    const allLinks = await page.$$eval('a[href]', (els: any[]) =>
      els.map((el: any) => ({ href: el.href, text: (el.innerText || '').trim().slice(0, 80) }))
    );
    for (const lnk of allLinks) {
      if (!lnk.href.includes('javascript')) {
        console.log(`  [${lnk.text || '(no text)'}] → ${lnk.href}`);
      }
    }

    const allBtns = await page.$$eval('button, tp-yt-paper-button, ytcp-button', (els: any[]) =>
      els.map((el: any) => (el.innerText || el.textContent || '').trim().slice(0, 60))
    );
    console.log('\n  Buttons:');
    allBtns.filter((t: string) => t.length > 0).forEach((t: string) => console.log(`  [BTN] "${t}"`));

    // STEP 5: Thử click "Chuyển đến trung tâm mua sắm" hoặc "affiliate_hub"
    console.log('\n[STEP 5] Tìm link Trung tâm mua sắm...');
    const affiliateHubLink = page.locator('a[href*="affiliate_hub"], text="Xem thêm", text="Chuyển đến trung tâm mua sắm"').first();
    if (await affiliateHubLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  → Click Trung tâm mua sắm...');
      await affiliateHubLink.click();
      await delay(3000);
      await bypassSplash(page);
      await snap(page, 'tab_step5_affiliate_hub.png');
      console.log(`  URL: ${page.url()}`);

      const hubText = await page.innerText('body');
      console.log('\n  Nội dung Trung tâm mua sắm:');
      hubText.split('\n').filter((l) => l.trim().length > 2).forEach((l) => console.log(`    | ${l.trim()}`));
      
      // Tìm Tuyển tập ở đây
      console.log(`\n  "Tuyển tập": ${hubText.includes('Tuyển tập')}`);
      console.log(`  "Bộ sưu tập": ${hubText.includes('Bộ sưu tập')}`);
      console.log(`  "Collection": ${hubText.includes('Collection')}`);
    }

    // STEP 6: Navigate đến affiliate_hub trực tiếp
    console.log('\n[STEP 6] Navigate trực tiếp đến affiliate_hub...');
    await page.goto(
      `https://studio.youtube.com/channel/${CHANNEL_ID}/monetization/affiliate_hub?approve_browser_access=true`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await delay(3500);
    await bypassSplash(page);
    await snap(page, 'tab_step6_affiliate_hub.png');
    console.log(`  URL: ${page.url()}`);

    const hubText2 = await page.innerText('body');
    const hubLines = hubText2.split('\n').filter((l) => l.trim().length > 2);
    console.log('\n  Nội dung affiliate_hub:');
    hubLines.forEach((l) => console.log(`    | ${l.trim()}`));
    console.log(`\n  "Tuyển tập": ${hubText2.includes('Tuyển tập')}`);
    console.log(`  "Bộ sưu tập": ${hubText2.includes('Bộ sưu tập')}`);

    // Links tại affiliate_hub
    const hubLinks = await page.$$eval('a[href]', (els: any[]) =>
      els.map((el: any) => ({ href: el.href, text: (el.innerText || '').trim().slice(0, 80) }))
    );
    console.log('\n  Links tại affiliate_hub:');
    hubLinks.filter((l: any) => l.href && !l.href.includes('javascript')).forEach((l: any) =>
      console.log(`  [${l.text || '(no text)'}] → ${l.href}`)
    );

  } catch (err: any) {
    console.error('\n❌ Lỗi:', err.message);
    await snap(page, 'tab_error.png').catch(() => {});
  } finally {
    console.log('\n⏳ Giữ 20 giây...');
    await delay(20000);
    await browser.close();
    process.exit(0);
  }
}

main();
