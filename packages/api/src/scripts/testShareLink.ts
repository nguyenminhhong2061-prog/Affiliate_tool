/**
 * Chỉ chạy PHASE 2: lấy link chia sẻ bộ sưu tập rồi trích link affiliate.
 * Không gắn thêm sản phẩm — dùng khi sản phẩm đã được đăng từ trước.
 *
 * Chạy: npx ts-node src/scripts/testShareLink.ts
 *   PRODUCT_NAME="..."  tên sản phẩm cần tìm trên trang bộ sưu tập
 */
import { AppiumYoutubeStudio, disposeSharedAppiumSession } from '../automation/appiumYoutubeStudio';
import { extractAffiliateFromCollection } from '../automation/collectionAffiliateExtractor';
import { closeOcr } from '../automation/ocr';

const PRODUCT_NAME =
  process.env.PRODUCT_NAME ?? 'Máy cạo râu mini coclear CS007 thiết kế động cơ tốc độ cao';
const SHOPEE_URL = process.env.TEST_SHOPEE_URL ?? 'https://vn.shp.ee/LcvcKnUG';

async function main() {
  console.log('========================================================');
  console.log(' 🔗 TEST PHASE 2 — LẤY LINK CHIA SẺ + TRÍCH AFFILIATE');
  console.log('========================================================');
  console.log(`  Sản phẩm cần tìm: "${PRODUCT_NAME}"\n`);

  const studio = new AppiumYoutubeStudio();
  studio.setJobId('test_share');

  try {
    await studio.init();
    const shareUrl = await studio.getCollectionShareLink();

    console.log('\n▶ Mở trang bộ sưu tập bằng Playwright...');
    const { affiliateUrl, voucher } = await extractAffiliateFromCollection(shareUrl, {
      shopeeUrl: SHOPEE_URL,
      jobId: 'test_share',
      productName: PRODUCT_NAME,
      headless: false,
    });

    console.log('\n========================================================');
    console.log(' ✅ KẾT QUẢ');
    console.log('========================================================');
    console.log(`  Link bộ sưu tập: ${shareUrl}`);
    console.log(`  Link affiliate:  ${affiliateUrl}`);
    console.log(`  Voucher:         ${voucher || '(sản phẩm không kèm voucher)'}`);
  } catch (err: unknown) {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await closeOcr();
    await studio.close();
    // Script chạy lẻ: phải đóng hẳn session, không giữ lại cho lần sau
    await disposeSharedAppiumSession();
  }
}

main();
