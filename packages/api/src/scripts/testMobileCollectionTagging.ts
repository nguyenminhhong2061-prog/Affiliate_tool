/**
 * Test full flow gắn sản phẩm qua Appium (native YouTube Studio app)
 * Chạy: npm run test-mobile
 *
 * Yêu cầu giống test-appium — xem automation.md
 */
import { tagShopeeProductOnYoutube } from '../automation/youtubeAutomation';
import { automationEnv } from '../automation/env';
import { closeOcr } from '../automation/ocr';
import { disposeSharedAppiumSession } from '../automation/appiumYoutubeStudio';

const SHOPEE_URL = process.env.TEST_SHOPEE_URL ?? 'https://vn.shp.ee/5YoD5Mjh';
/** DRY_RUN=1 → chạy hết luồng nhưng KHÔNG bấm "Đăng" (không thay đổi kênh) */
const DRY_RUN = process.env.DRY_RUN === '1';

async function testMobileCollectionTagging() {
  console.log('========================================================================');
  console.log(' 📱 TEST FULL FLOW — APPIUM + PLAYWRIGHT');
  console.log('========================================================================');
  console.log(`🔗 Link sản phẩm: ${SHOPEE_URL}`);
  console.log(`⚙️  Automation mode: ${automationEnv.AUTOMATION_MODE}`);
  console.log(`📦 Bộ sưu tập: ${automationEnv.YT_COLLECTION_NAME || '(thẻ đầu tiên)'}`);
  console.log(
    DRY_RUN
      ? '🛑 DRY RUN — sẽ DỪNG trước khi bấm "Đăng", không xuất bản gì\n'
      : '⚠️  CHẠY THẬT — sẽ bấm "Đăng" và gắn sản phẩm lên kênh\n',
  );

  const jobId = `test_mobile_${Date.now()}`;

  try {
    const result = await tagShopeeProductOnYoutube({
      jobId,
      shopeeUrl: SHOPEE_URL,
      dryRun: DRY_RUN,
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
  } finally {
    // Worker OCR giữ event loop sống — các script khác đều gọi bước này, riêng
    // script dry-run chính thì thiếu.
    await closeOcr();

    // Session Appium nay được giữ sống giữa các job để tiết kiệm ~10,5 giây.
    // Script chạy lẻ phải đóng hẳn, nếu không nó còn nằm trên Appium server tới
    // hết newCommandTimeout và chặn lần chạy sau.
    await disposeSharedAppiumSession();

    // Dọn xong rồi mà tiến trình VẪN không tự thoát: còn phụ thuộc khác giữ
    // handle (đã loại trừ OCR và Appium session — cả hai đều được đóng đúng).
    // Chưa truy ra thủ phạm; với script CLI thì thoát tường minh là chấp nhận
    // được, và nó bỏ được việc phải Ctrl+C sau mỗi lần chạy.
    // Chờ một nhịp cho stdout kịp xả hết khi output đang được ghi ra file.
    await new Promise((resolve) => setTimeout(resolve, 200));
    process.exit(process.exitCode ?? 0);
  }
}

testMobileCollectionTagging();
