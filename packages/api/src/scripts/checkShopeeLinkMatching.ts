/**
 * Kiểm tra logic so khớp sản phẩm theo ID — chạy được mà KHÔNG cần điện thoại.
 *
 * Vì sao đáng có: đây là đoạn quyết định người dùng nhận đúng hay sai sản phẩm.
 * CLAUDE.md §10.7 ghi lại hai lần hệ thống từng trả dữ liệu bịa; so khớp sai một
 * cách im lặng chính là cách thứ ba để mắc lại lỗi đó. Toàn bộ logic ở đây là
 * hàm thuần nên kiểm tra được ngay, không phải chờ tới lúc chạy job thật.
 *
 *   npx ts-node src/scripts/checkShopeeLinkMatching.ts
 */
import { parseProductRef, extractOriginRef, sameProduct, formatRef } from '../automation/shopeeLink';

/** Sản phẩm thật đã xác minh trong CLAUDE.md §5 (job d64483bb, 2026-08-16) */
const TARGET = { sellerId: '1274547388', productId: '28130046415' };

const cases: Array<{ name: string; run: () => boolean }> = [
  {
    name: 'parse dạng /product/SELLER/PRODUCT',
    run: () => {
      const r = parseProductRef('https://shopee.vn/product/1274547388/28130046415');
      return r !== null && sameProduct(r, TARGET);
    },
  },
  {
    name: 'parse dạng -i.SELLER.PRODUCT',
    run: () => {
      const r = parseProductRef('https://shopee.vn/Tai-nghe-Sony-i.1274547388.28130046415?sp=1');
      return r !== null && sameProduct(r, TARGET);
    },
  },
  {
    name: 'origin_link encode 1 lớp (đúng mẫu đã thấy thật)',
    run: () => {
      const r = extractOriginRef(
        'https://s.shopee.vn/abc123?origin_link=https%3A%2F%2Fshopee.vn%2Fproduct%2F1274547388%2F28130046415&gads_t_sig=xyz',
      );
      return r !== null && sameProduct(r, TARGET);
    },
  },
  {
    name: 'origin_link encode 2 lớp',
    run: () => {
      const inner = encodeURIComponent(
        encodeURIComponent('https://shopee.vn/product/1274547388/28130046415'),
      );
      const r = extractOriginRef(`https://s.shopee.vn/abc?origin_link=${inner}`);
      return r !== null && sameProduct(r, TARGET);
    },
  },
  {
    name: 'ID nằm ở tham số mang tên khác',
    run: () => {
      const r = extractOriginRef(
        'https://s.shopee.vn/x?redir=https%3A%2F%2Fshopee.vn%2FAo-i.1274547388.28130046415',
      );
      return r !== null && sameProduct(r, TARGET);
    },
  },
  {
    name: 'link KHÔNG chứa ID nào → null (không được đoán bừa)',
    run: () => extractOriginRef('https://s.shopee.vn/9fAbCdEf?utm_source=yt') === null,
  },
  {
    name: 'productId khác → KHÔNG khớp',
    run: () => {
      const r = extractOriginRef(
        'https://s.shopee.vn/x?origin_link=https%3A%2F%2Fshopee.vn%2Fproduct%2F1274547388%2F99999999999',
      );
      return r !== null && !sameProduct(r, TARGET);
    },
  },
  {
    name: 'cùng productId nhưng khác seller → KHÔNG khớp',
    run: () => {
      const r = extractOriginRef(
        'https://s.shopee.vn/x?origin_link=https%3A%2F%2Fshopee.vn%2Fproduct%2F9999999%2F28130046415',
      );
      return r !== null && !sameProduct(r, TARGET);
    },
  },
];

let failed = 0;
for (const c of cases) {
  let ok = false;
  let note = '';
  try {
    ok = c.run();
  } catch (err) {
    note = ` (ném lỗi: ${err instanceof Error ? err.message : String(err)})`;
  }
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${c.name}${note}`);
}

console.log(`\nSản phẩm mục tiêu: ${formatRef(TARGET)}`);
console.log(failed === 0 ? 'TẤT CẢ ĐỀU ĐÚNG' : `${failed} trường hợp SAI`);
process.exit(failed === 0 ? 0 : 1);
