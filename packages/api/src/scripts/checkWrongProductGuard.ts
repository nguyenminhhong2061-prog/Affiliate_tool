/**
 * Bài kiểm tra hồi quy cho lỗi TRẢ SAI SẢN PHẨM (2026-08-16).
 *
 * ── Lỗi đã xảy ra ────────────────────────────────────────────────────────────
 * Job gắn đúng sản phẩm Samsung A17 LTE (1615222441/42529174899) và đã xác minh,
 * nhưng trang bộ sưu tập công khai chưa kịp cập nhật nên Phase 3 chỉ thấy danh
 * sách cũ. So khớp theo ID làm đúng — không tìm thấy. Rồi ĐƯỜNG LUI SO TÊN đè
 * lên, khớp 57% với một máy Samsung A17 LTE *khác* đã nằm sẵn trong bộ sưu tập,
 * và trả link của máy đó cho người dùng.
 *
 * ── Điều bài kiểm tra này khẳng định ────────────────────────────────────────
 * Khi đã biết ID sản phẩm mà ID đó không có trên trang, hệ thống phải TỪ CHỐI —
 * kể cả khi có một sản phẩm khác trùng tên tới mức vượt mọi ngưỡng. Đây là ranh
 * giới của CLAUDE.md §10.7: thà báo lỗi còn hơn trả dữ liệu sai.
 *
 * Chạy (không cần điện thoại, chỉ cần một link bộ sưu tập còn sống):
 *   npx ts-node src/scripts/checkWrongProductGuard.ts "<link bộ sưu tập>"
 */
import { extractAffiliateFromCollection } from '../automation/collectionAffiliateExtractor';

/** ID không tồn tại trong bất kỳ bộ sưu tập nào */
const ABSENT_REF = { sellerId: '9999999999', productId: '8888888888' };

/**
 * Tên CỐ TÌNH trùng với một sản phẩm có thật trên trang. Đây là cái bẫy: nếu
 * đường lui so tên còn sống, nó sẽ khớp cái này và trả về link sai.
 */
const DECOY_NAME = 'Samsung Galaxy A17 LTE 8/128GB Smartphone chính hãng';

async function main() {
  const collectionUrl = process.argv[2];
  if (!collectionUrl) {
    console.error('Thiếu tham số: đường dẫn trang bộ sưu tập');
    process.exit(1);
  }

  console.log('Kịch bản: ID sản phẩm KHÔNG có trên trang, nhưng tên thì trùng một sản phẩm có thật.');
  console.log(`  ID cần tìm (không tồn tại): ${ABSENT_REF.sellerId}/${ABSENT_REF.productId}`);
  console.log(`  Tên mồi nhử:                "${DECOY_NAME}"`);
  console.log('  Kỳ vọng: TỪ CHỐI, không trả link nào.\n');

  try {
    const result = await extractAffiliateFromCollection(collectionUrl, {
      jobId: 'regression_wrong_product',
      targetRef: ABSENT_REF,
      productName: DECOY_NAME,
      headless: true,
    });

    console.error('\n❌ HỎNG BÀI KIỂM TRA — hệ thống đã trả về một link thay vì từ chối:');
    console.error(`   ${result.affiliateUrl.slice(0, 160)}`);
    console.error('   Đây đúng là lỗi trả sai sản phẩm đã từng xảy ra.');
    process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`\n✅ ĐẠT — hệ thống từ chối đúng như mong đợi:\n   ${message}`);
    process.exit(0);
  }
}

main();
