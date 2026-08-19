/**
 * Nhận dạng link Shopee ở tầng API.
 *
 * ── Ở đây KHÔNG có tên và ảnh sản phẩm, và đó là chủ ý ──────────────────────
 * Bản trước có `fetchShopeeProduct()` trả về dữ liệu giả: chọn tên từ một mảng
 * 5 phần tử cứng theo *chữ số cuối của productId*, rồi API đưa thẳng tên đó vào
 * phản hồi `POST /jobs`. Quan sát thật ngày 2026-08-16: gửi link một chiếc
 * Samsung Galaxy A17, API trả về "Máy lọc không khí Xiaomi Air Purifier 4 Pro".
 *
 * Chưa ai thấy chỉ vì app mobile không hiển thị trường đó — nghĩa là dữ liệu bịa
 * đã nằm sẵn trong phản hồi hàng tuần, chờ một client nào đó đọc phải. Đây đúng
 * là loại lỗi CLAUDE.md §10.7 xếp nguy hiểm nhất của dự án.
 *
 * Nay bỏ hẳn: `shopeeProductName` và `shopeeProductImage` để `null`. **Thiếu dữ
 * liệu thì nói là thiếu, không lấp bằng dữ liệu sai.** Muốn có tên và ảnh thật
 * thì phải tích hợp Shopee Affiliate Open API — chưa làm, và không được giả vờ
 * là đã làm.
 *
 * Lưu ý: ID sản phẩm KHÔNG bịa — nó bóc trực tiếp từ URL người dùng gửi.
 */
import { parseProductRef, type ShopeeProductRef } from '../automation/shopeeLink';

/**
 * Bóc `{sellerId, productId}` từ URL Shopee.
 *
 * Dùng chung bộ nhận dạng với tầng automation (`automation/shopeeLink.ts`) thay
 * vì giữ một bản sao riêng: bước trích link affiliate so khớp sản phẩm theo
 * đúng ID này, nên hai nơi hiểu URL khác nhau sẽ sinh ra sai lệch âm thầm.
 *
 * Link rút gọn (shope.ee, vn.shp.ee) không chứa ID nên trả `null` — muốn giải
 * phải đi theo chuyển hướng, và việc đó thuộc về worker chứ không phải đường xử
 * lý HTTP đồng bộ của `POST /jobs`.
 */
export function parseShopeeUrl(url: string): ShopeeProductRef | null {
  return parseProductRef(url);
}

/** Kiểm tra URL có thuộc Shopee Việt Nam không */
export function isValidShopeeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'shopee.vn' ||
      parsed.hostname === 'shope.ee' ||
      parsed.hostname === 's.shopee.vn' ||
      parsed.hostname === 'vn.shp.ee' ||
      parsed.hostname === 'shp.ee'
    );
  } catch {
    return false;
  }
}
