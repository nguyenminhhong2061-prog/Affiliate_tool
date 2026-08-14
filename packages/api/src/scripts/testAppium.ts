/**
 * Test kết nối Appium và chạy thử YouTube Studio
 * Chạy: npm run test-appium
 *
 * Yêu cầu:
 *   1. Appium đang chạy: appium --port 4723
 *   2. Điện thoại đã kết nối USB + USB Debugging bật
 *   3. YouTube Studio đã cài trên điện thoại
 */
import { AppiumYoutubeStudio } from '../automation/appiumYoutubeStudio';
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SHOPEE_URL = 'https://vn.shp.ee/5YoD5Mjh';
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots/appium');

async function extractAffiliateLink(collectionShareUrl: string): Promise<string> {
  console.log('\n═══════════════════════════════════════════════');
  console.log(' 🌐 TRÍCH XUẤT LINK AFFILIATE TỪ BỘ SƯU TẬP');
  console.log('═══════════════════════════════════════════════');
  console.log(`  URL bộ sưu tập: ${collectionShareUrl}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto(collectionShareUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'collection_page.png'), fullPage: true });
    console.log('  📸 Chụp trang bộ sưu tập');

    // Tìm tất cả links sản phẩm trên trang
    const productLinks = await page.$$eval('a[href]', (els: any[]) =>
      els
        .map((el: any) => ({ href: el.href, text: (el.innerText || '').trim().slice(0, 100) }))
        .filter((l: any) => l.href.includes('shopee') || l.href.includes('shp.ee') || l.href.includes('lazada') || l.href.includes('youtube'))
    );

    console.log(`\n  Tìm thấy ${productLinks.length} link sản phẩm:`);
    for (const link of productLinks) {
      console.log(`  [${link.text || '(no text)'}] → ${link.href}`);
    }

    // Lấy link đầu tiên có dạng Shopee
    const shopeeLink = productLinks.find(
      (l: any) => l.href.includes('shopee') || l.href.includes('shp.ee')
    );

    if (shopeeLink) {
      console.log(`\n  ✅ Link affiliate: ${shopeeLink.href}`);
      return shopeeLink.href;
    }

    // Thử tìm link theo button/card
    const allLinks = await page.$$eval('a[href]', (els: any[]) =>
      els.map((el: any) => el.href)
    );
    const affiliateLink = allLinks.find(
      (href: string) => href.includes('shp.ee') || href.includes('shopee.vn')
    );

    return affiliateLink || collectionShareUrl;
  } finally {
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' 📱 TEST APPIUM + YOUTUBE STUDIO → AFFILIATE LINK');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Sản phẩm Shopee: ${SHOPEE_URL}\n`);

  const studio = new AppiumYoutubeStudio();

  try {
    // Khởi động Appium
    console.log('[STEP 1] Kết nối Appium...');
    await studio.init();

    // Gắn sản phẩm vào Tuyển tập
    console.log('\n[STEP 2] Gắn sản phẩm vào Tuyển tập...');
    const shareLink = await studio.addProductToCollection(SHOPEE_URL);

    if (!shareLink) {
      throw new Error('Không lấy được link chia sẻ bộ sưu tập');
    }

    // Trích xuất link affiliate
    console.log('\n[STEP 3] Trích xuất link affiliate...');
    const affiliateLink = await extractAffiliateLink(shareLink);

    console.log('\n══════════════════════════════════════════════════');
    console.log(' ✅ KẾT QUẢ HOÀN THÀNH');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Link Shopee gốc:   ${SHOPEE_URL}`);
    console.log(`  Link bộ sưu tập:   ${shareLink}`);
    console.log(`  Link affiliate:    ${affiliateLink}`);

  } catch (err: any) {
    console.error(`\n❌ Lỗi: ${err.message}`);

    if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
      console.log('\n💡 Appium chưa chạy! Hãy mở terminal mới và chạy:');
      console.log('   appium --port 4723');
    } else if (err.message.includes('thiết bị')) {
      console.log('\n💡 Không tìm thấy điện thoại. Hãy:');
      console.log('   1. Cắm cáp USB');
      console.log('   2. Bật USB Debugging trên điện thoại');
      console.log('   3. Chấp nhận "Cho phép gỡ lỗi qua USB"');
      console.log('   4. Chạy: npm run check-adb');
    }
  } finally {
    await studio.close();
    process.exit(0);
  }
}

main();
