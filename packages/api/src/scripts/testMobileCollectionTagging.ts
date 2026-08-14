/**
 * Test full flow gắn sản phẩm qua Appium (native YouTube Studio app)
 * Chạy: npm run test-mobile
 *
 * Yêu cầu giống test-appium — xem automation.md
 */
import { tagShopeeProductOnYoutube } from '../automation/youtubeAutomation';
import { automationEnv } from '../automation/env';

const SHOPEE_URL = process.env.TEST_SHOPEE_URL ?? 'https://vn.shp.ee/5YoD5Mjh';

async function testMobileCollectionTagging() {
  console.log('========================================================================');
  console.log(' 📱 TEST FULL FLOW — APPIUM + PLAYWRIGHT (automation.md)');
  console.log('========================================================================');
  console.log(`🔗 Link sản phẩm: ${SHOPEE_URL}`);
  console.log(`⚙️  Automation mode: ${automationEnv.AUTOMATION_MODE}\n`);

  const jobId = `test_mobile_${Date.now()}`;

  try {
    const result = await tagShopeeProductOnYoutube({
      jobId,
      shopeeUrl: SHOPEE_URL,
    });

    console.log('\n========================================================================');
    console.log(' ✅ HOÀN THÀNH');
    console.log('========================================================================');
    console.log(`  Affiliate URL: ${result.affiliateUrl}`);
    console.log(`  Voucher:       ${result.voucher}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Lỗi: ${message}`);
    process.exitCode = 1;
  }
}

testMobileCollectionTagging();
