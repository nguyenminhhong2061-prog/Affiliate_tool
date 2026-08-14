/**
 * Test kết nối Appium và chạy thử full pipeline
 * Chạy: npm run test-appium
 *
 * Yêu cầu:
 *   1. Appium đang chạy: appium --port 4723
 *   2. Điện thoại đã kết nối USB + USB Debugging bật
 *   3. YouTube Studio đã cài trên điện thoại
 */
import { AppiumYoutubeStudio } from '../automation/appiumYoutubeStudio';
import { extractAffiliateFromCollection } from '../automation/collectionAffiliateExtractor';

const SHOPEE_URL = process.env.TEST_SHOPEE_URL ?? 'https://vn.shp.ee/5YoD5Mjh';

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' 📱 TEST APPIUM + YOUTUBE STUDIO → AFFILIATE LINK');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Sản phẩm Shopee: ${SHOPEE_URL}\n`);

  const studio = new AppiumYoutubeStudio();
  studio.setJobId('test_appium');

  try {
    console.log('[STEP 1] Kết nối Appium...');
    await studio.init();

    console.log('\n[STEP 2] Gắn sản phẩm vào Tuyển tập...');
    const shareLink = await studio.addProductToCollection(SHOPEE_URL);

    if (!shareLink) {
      throw new Error('Không lấy được link chia sẻ bộ sưu tập');
    }

    console.log('\n[STEP 3] Trích xuất link affiliate (Playwright)...');
    const { affiliateUrl, voucher } = await extractAffiliateFromCollection(shareLink, {
      shopeeUrl: SHOPEE_URL,
      jobId: 'test_appium',
      headless: false,
    });

    console.log('\n══════════════════════════════════════════════════');
    console.log(' ✅ KẾT QUẢ HOÀN THÀNH');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Link Shopee gốc:   ${SHOPEE_URL}`);
    console.log(`  Link bộ sưu tập:   ${shareLink}`);
    console.log(`  Link affiliate:    ${affiliateUrl}`);
    console.log(`  Voucher:           ${voucher}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Lỗi: ${message}`);

    if (message.includes('ECONNREFUSED') || message.includes('connect')) {
      console.log('\n💡 Appium chưa chạy! Hãy mở terminal mới và chạy:');
      console.log('   appium --port 4723');
    } else if (message.includes('thiết bị') || message.includes('Android')) {
      console.log('\n💡 Không tìm thấy điện thoại. Hãy:');
      console.log('   1. Cắm cáp USB');
      console.log('   2. Bật USB Debugging trên điện thoại');
      console.log('   3. Chấp nhận "Cho phép gỡ lỗi qua USB"');
      console.log('   4. Chạy: npm run check-adb');
    }
    process.exitCode = 1;
  } finally {
    await studio.close();
  }
}

main();
